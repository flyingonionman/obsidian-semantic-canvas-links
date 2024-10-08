import { App, Menu, MetadataCache, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder, TextFileView, View, getFrontMatterInfo } from 'obsidian';
import { AllCanvasNodeData, CanvasData, CanvasEdgeData, CanvasFileData, CanvasGroupData, CanvasLinkData, CanvasNodeData, CanvasTextData, NodeSide } from 'canvas';

interface SemanticCanvasPluginSettings {
	/* Note ➡️ canvas */
	newFileLocation: Location;
	customFileLocation: string;
	/* Canvas ➡️ note */
	cardDefault: string;
	fileDefault: string;
	urlDefault: string;
	groupDefault: string;
	useCards: boolean;
	useUrls: boolean;
	useFiles: boolean;
	useGroups: boolean;
	/**
	 * Whether or not the "Alias" key should create nodes
	 */
	includeAlias: boolean;
}

export enum Location {
	VaultFolder,
	SameFolder,
	SpecifiedFolder,
}

interface CanvasNodeMap {
	cards?: Array<CanvasTextData>,
	files?: Array<CanvasFileData> & { inGroups?: Array<CanvasGroupData> },
	urls?: Array<CanvasLinkData>,
	groups?: Array<CanvasGroupData>
}

interface CanvasMap extends CanvasNodeMap {
	edges?: Array<CanvasEdgeData & { isBidirectional: boolean }>
}

type ConnectionProps = {
	otherSideId?: string;
	otherSide?: CanvasNodeData
	type?: 'card' | 'url' | 'file' | 'group';
	isBidirectional?: boolean;
	propLbl?: string;
	propVal?: string;
}

type RawCanvasObj = {
	nodes: Array<CanvasNodeData>,
	edges: Array<CanvasEdgeData>
}

const DEFAULT_SETTINGS: SemanticCanvasPluginSettings = {
	newFileLocation: Location.VaultFolder,
	customFileLocation: '',
	// The default strings for unlabeled edges
	cardDefault: 'cards',
	fileDefault: 'files',
	urlDefault: 'urls',
	// The string for group containment
	groupDefault: 'groups',
	// For disabling whole types of interactions
	useCards: true,
	useUrls: true,
	useFiles: true,
	useGroups: false,
	includeAlias: false
}

/**
 * Represents an instance of a node on the canvas that represents a file in the vault
 */
class FileNode {
	filePath: string;
	propsOnCanvas: any;
	app: App;

	/**
	 * A Node on the Canvas that represents a file in the vault
	 * @param file 
	 * @param data 
	 * @param settings 
	 * @returns 
	 */
	constructor(file: CanvasFileData, data: CanvasMap, settings: SemanticCanvasPluginSettings, appRef: App) {
		this.filePath = file.file;
		this.propsOnCanvas = {};
		this.app = appRef; //for access to metadatacache

		if (file.inGroups === undefined) file.inGroups = [];

		let relevantIds = [file.id]; //the node ID itself...
		relevantIds = [file.id, ...file.inGroups.map((g: any) => g.id)]; //...+ any groups that contain it

		const relevantEdges = data.edges?.filter(edge => {
			if (relevantIds.some(id => edge.fromNode == id)) return true
			/* In case link is bi-directional */
			if (relevantIds.some(id => edge.toNode == id && edge.isBidirectional)) return true
			return false
		})

		if (relevantEdges?.length === 0 && file.inGroups.length === 0) {
			this.propsOnCanvas = null;
			return
		}

		let edges: ConnectionProps[] = relevantEdges?.map(edge => {
			let newEdge: ConnectionProps = {
				otherSideId: edge.toNode,
				isBidirectional: edge.isBidirectional
			}
			if (file.id === newEdge.otherSideId) newEdge.otherSideId = edge.fromNode;
			newEdge.otherSide = data.cards?.find(card => card.id === newEdge.otherSideId);
			newEdge.type = 'card';
			newEdge.propLbl = settings.cardDefault
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.urls?.find(url => url.id === newEdge.otherSideId);
				newEdge.type = 'url';
				newEdge.propLbl = settings.urlDefault
			}
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.files?.find(file => file.id === newEdge.otherSideId);
				newEdge.type = 'file';
				newEdge.propLbl = settings.fileDefault
			}
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.groups?.find(group => group.id === newEdge.otherSideId);
				//#TODO - can you prevent "in group" memberships here when there's an arrow to the group with the same label as the group?
				newEdge.type = 'group';
			}
			if (newEdge.otherSide === undefined) throw new Error('Could not find other side of edge');
			if (newEdge.type === 'card') newEdge.propVal = newEdge.otherSide.text;
			if (newEdge.type === 'url') newEdge.propVal = newEdge.otherSide.url;
			if (newEdge.type === 'file') newEdge.propVal = convertToWikilink(newEdge.otherSide as CanvasFileData, this)
			if (edge.label !== undefined) newEdge.propLbl = edge.label;
			return newEdge
		}).filter(newEdge => newEdge.propLbl !== undefined && newEdge.propLbl !== '')!;

		/* ALL PROPERTIES ARE ARRAYS OF STRINGS */

		/* this -> contained in group */
		if (file.inGroups.length > 0 && settings.useGroups) {
			this.propsOnCanvas[settings.groupDefault] = file.inGroups.map((group: CanvasGroupData) => group.label);
		}

		/* this -> card */
		if (settings.useCards) {
			edges.filter(edge => edge.type === 'card').forEach(edge => {
				if (!this.propsOnCanvas.hasOwnProperty(edge.propLbl)) {
					this.propsOnCanvas[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			})
		}

		/* this -> url */
		if (settings.useUrls) {
			edges.filter(edge => edge.type === 'url').forEach(edge => {
				if (!this.propsOnCanvas.hasOwnProperty(edge.propLbl)) {
					this.propsOnCanvas[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			})
		}
		/* this -> note */
		if (settings.useFiles) {
			edges.filter(edge => edge.type === 'file').forEach(edge => {
				if (!this.propsOnCanvas.hasOwnProperty(edge.propLbl)) {
					this.propsOnCanvas[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			})
		}

		function convertToWikilink(otherSide: CanvasFileData, that: FileNode): string {
			const otherFile = that.app.metadataCache.getFirstLinkpathDest(otherSide.file, that.filePath) as TFile;
			let linkTextContent = that.app.metadataCache.fileToLinktext(otherFile, that.filePath);
			/* see if Subpaths were used */
			if (otherSide.hasOwnProperty("subpath")) linkTextContent = linkTextContent + otherSide.subpath;
			return "[[" + linkTextContent + "]]";
		}
	}
}

export default class SemanticCanvasPlugin extends Plugin {
	settings: SemanticCanvasPluginSettings;

	async onload() {
		await this.loadSettings();

		/* This command will replace the values of an already-existing property */
		this.addCommand({
			id: 'set-canvas-to-note-properties',
			name: 'Overwrite note properties based on canvas',
			callback: () => {
				this.pushCanvasToNoteProperties(true);
			}
		});

		/* This command will add new values onto the end of an already-existing property */
		this.addCommand({
			id: 'append-canvas-to-note-properties',
			name: 'Append note properties based on canvas',
			callback: () => {
				this.pushCanvasToNoteProperties(false);
			}
		});

		this.addCommand({
			id: 'update-canvas-with-current-note-data',
			name: 'Update canvas with current note data',
			callback: () => {
				console.log('yo');
			}
		})

		/* This command will add new values onto the end of an already-existing property */
		this.addCommand({
			id: 'create-canvas-from-note',
			name: 'Create canvas based on note',
			callback: () => {
				this.createCanvasFromNote();
			}
		});

		this.addSettingTab(new SemanticCanvasSettingsTab(this.app, this));

		/**
		 * Right-clicking edges. Could make for a more discrete edit possibility, but deferring
		 * to a later date 
		 */
		this.registerEvent(
			//@ts-expect-error - it works, despite TypeScript not seeing the 'canvas:' methods
			this.app.workspace.on("canvas:edge-menu", (menu: Menu, edge: any) => {
				if (edge.label === '' || edge.toLineEnd === null || edge.from.node.filePath === undefined) return;
				const isBidirectional = edge.fromLineEnd !== null && edge.to.node.filePath !== undefined;
				menu.addItem((item: any) => {
					item.setTitle(isBidirectional ? "Remove property from both notes" : "Remove property from source note")
						.setIcon("up-and-down-arrows")
						.onClick(() => {
							const file = this.app.vault.getFileByPath(edge.from.node.filePath);
							if (file === null) return;
							this.app.fileManager.processFrontMatter(file, (frontmatter) => {
								frontmatter[edge.label] = undefined;
							})

							//supporting bi-directionally
							if (isBidirectional) {
								const otherFile = this.app.vault.getFileByPath(edge.to.node.filePath);
								if (otherFile === null) return;
								this.app.fileManager.processFrontMatter(otherFile, (frontmatter) => {
									frontmatter[edge.label] = undefined;
								})
							}
						})
				})
				menu.addItem((item: any) => {
					item.setTitle(isBidirectional ? "Update property in both notes" : "Update property in source note")
						.setIcon("up-and-down-arrows")
						.onClick(() => {
							let toVal = edge.to.node.text;
							if (toVal === undefined) {
								const filenameAsWikiLink = "[[" + edge.to.node.filePath.split('/').pop()!.substring(0, edge.to.node.filePath.split('/').pop()!.length - 3) + "]]";
								toVal = filenameAsWikiLink;
							}

							const file = this.app.vault.getFileByPath(edge.from.node.filePath);
							if (file === null) return;
							this.app.fileManager.processFrontMatter(file, (frontmatter) => {
								frontmatter[edge.label] = toVal;
							})

							//supporting bi-directionally
							if (isBidirectional) {
								let otherToVal = edge.from.node.text;
								if (otherToVal === undefined) {
									const filenameAsWikiLink = "[[" + edge.from.node.filePath.split('/').pop()!.substring(0, edge.from.node.filePath.split('/').pop()!.length - 3) + "]]";
									otherToVal = filenameAsWikiLink;
								}
								const otherFile = this.app.vault.getFileByPath(edge.to.node.filePath);
								if (otherFile === null) return;
								this.app.fileManager.processFrontMatter(otherFile, (frontmatter) => {
									frontmatter[edge.label] = otherToVal;
								})
							}
						})
				})
			})
		)

		/**
		 * was trying to get somethign to fire when right-clicking an edge or non-file node, but no.
		 */
		this.registerEvent(
			//@ts-expect-error - it works, despite TypeScript not seeing the 'canvas:' methods
			this.app.workspace.on("canvas:node-connection-drop-menu", (menu: Menu, edge: any, third: any) => {
				if (edge.file === undefined) return; //dragging from group or card
				const noteProps = this.getNoteData(edge.file.path);
				noteProps.forEach(prop => {
					menu.addItem((item: any) => {
						const key = Object.keys(prop)[0];
						item.setTitle("Pull property: " + key)
							.setIcon("down-arrow")
							.onClick(() => {
								const activeView = this.app.workspace.getActiveViewOfType(TextFileView);
								if (activeView === null) {
									new Notice('Aborted: Active view was null');
									return;
								}
								if (activeView?.file?.extension !== 'canvas') {
									new Notice('Aborted: Active view is not a canvas');
									return;
								}
								this.addNodeDataAtLocation(activeView, prop[key], key, third.to.node.x, third.to.node.y, third.from.node);
							})
					})
				})
			})
		)

		/**
		 * was trying to get somethign to fire when right-clicking an edge or non-file node, but no.
		 */
		// this.registerEvent(
		////@ts-expect-error - it works, despite TypeScript not seeing the 'canvas:' methods
		// this.app.workspace.on("canvas:selection-menu", (menu: Menu, edge: any) => {
		// console.log('SUPER!!!');
		// fires when a box is drawn around several items, then the context menu is invoked
		// can't think of useful things to add to this menu. So this is all commented.
		// })
		// )


		/**
		 * was trying to get somethign to fire when right-clicking an edge or non-file node, but no.
		 */
		this.registerEvent(
			//@ts-expect-error - it works, despite TypeScript not seeing the 'canvas:' methods
			this.app.workspace.on("canvas:node-menu", (menu: Menu, node: CanvasNodeData) => {
				if (node.file === undefined) return
				menu.addItem((item: any) => {
					item.setTitle('Pull note properties in to canvas')
						.setIcon('arrow-down-to-line')
						.onClick(() => {
							const activeView = this.app.workspace.getActiveViewOfType(TextFileView);
							if (activeView === null) {
								new Notice('Aborted: Active view was null');
								return;
							}
							if (activeView?.file?.extension !== 'canvas') {
								new Notice('Aborted: Active view is not a canvas');
								return;
							}
							this.pullNotePropertiesToCanvas(activeView, [node], false);
						});
				})
				menu.addItem((item: any) => {
					item.setTitle('Show existing connections')
						.setIcon('arrow-down-to-line')
						.onClick(() => {
							const activeView = this.app.workspace.getActiveViewOfType(TextFileView);
							if (activeView === null) {
								new Notice('Aborted: Active view was null');
								return;
							}
							if (activeView?.file?.extension !== 'canvas') {
								new Notice('Aborted: Active view is not a canvas');
								return;
							}
							this.pullNotePropertiesToCanvas(activeView, [node], true);
						});
				})
			})
		)

		/* File Menu */
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, test) => {
				/* If visible window is Canvas, then we're in a right-click on node menu */
				const currentWindowFileType = this.app.workspace.getActiveFile()?.extension

				if (file instanceof TFolder || file === undefined) return;
				/* If Markdown file offer to create canvas */
				if ((<TFile>file).extension === 'md') {//} && currentWindowFileType == 'md') {
					menu.addItem((item) => {
						item.setTitle('Create canvas based on note')
							.setIcon('up-and-down-arrows')
							.onClick(() => {
								this.createCanvasFromNote(file as TFile);
							});
					});
				}


				/* If Canvas offer to update notes */
				if ((<TFile>file).extension === 'canvas') {
					menu.addItem((item) => {
						item.setTitle('Append note properties based on canvas')
							.setIcon('up-and-down-arrows')
							.onClick(() => {
								this.pushCanvasToNoteProperties(false, file as TFile);
							});
					});
					menu.addItem((item) => {
						item.setTitle('Overwrite note properties based on canvas')
							.setIcon('up-and-down-arrows')
							.onClick(() => {
								this.pushCanvasToNoteProperties(true, file as TFile);
							});
					});
					/* and offer to update Canvas with current note */
					menu.addItem((item) => {
						item.setTitle('Pull in properies for all notes on this canvas')
							.setIcon('up-and-down-arrows')
							.onClick(() => {
								const activeView = this.app.workspace.getActiveViewOfType(TextFileView);
								if (activeView === null) {
									new Notice('Aborted: Active view was null');
									return;
								}
								if (activeView?.file?.extension !== 'canvas') {
									new Notice('Aborted: Active view is not a canvas');
									return;
								}
								const nodes = JSON.parse(activeView.data)['nodes'].filter((node: any) => node.type === 'file');
								this.pullNotePropertiesToCanvas(activeView, nodes, false);
							});
					});
					menu.addItem((item) => {
						item.setTitle('Show all connections between notes on this canvas')
							.setIcon('up-and-down-arrows')
							.onClick(() => {
								const activeView = this.app.workspace.getActiveViewOfType(TextFileView);
								if (activeView === null) {
									new Notice('Aborted: Active view was null');
									return;
								}
								if (activeView?.file?.extension !== 'canvas') {
									new Notice('Aborted: Active view is not a canvas');
									return;
								}
								const nodes = JSON.parse(activeView.data)['nodes'].filter((node: any) => node.type === 'file');
								this.pullNotePropertiesToCanvas(activeView, nodes, true);
							});
					});
				}
			})
		);
	}

	/**
	 * The main function for using a note to create a new canvas.
	 */
	async createCanvasFromNote(file?: TFile) {
		//@ts-expect-error
		if (file === undefined) file = this.app.workspace.getActiveFile();
		if (!file || file?.extension !== 'md') {
			new Notice('Aborted: Active file is not Markdown file');
			return;
		}

		const name = file.basename;
		new Notice('Creating canvas for ' + name);

		const allProperties = this.app.metadataCache.getCache(file.path)?.frontmatter;
		let listTypeProps = this.getNoteData(file.path);

		const that = this;
		const canvasContents = buildCanvasContents(file, listTypeProps);

		const savePath = createSavePathBasedOnSettings(file, that);
		const createdCanvas = await this.app.vault.create(savePath, JSON.stringify(canvasContents));
		this.app.workspace.getLeaf().openFile(createdCanvas);

		function buildCanvasContents(file: TFile, propsMap: Array<{ [index: string]: Array<string> }>): CanvasData {
			const thisFileNodeData: CanvasFileData = {
				color: "1",
				x: 0,
				y: 0,
				id: '0',
				width: 400,
				height: 400,
				type: 'file',
				file: file.path
			}

			let canvasContents: CanvasData = {
				nodes: [thisFileNodeData],
				edges: []
			}

			if (propsMap.length === 0) return canvasContents;

			const firstColumnPosition = 600;
			let curY = 0;
			let nodeCount = 1;
			let edgeCount = 0;

			/* Iterate through the props & mutate the canvasContents for each */
			propsMap.forEach(propObj => {
				const key = Object.keys(propObj)[0];
				const valArr = propObj[key]; //will be array
				if (!Array.isArray(valArr)) throw new Error("A non-array was passed into buildCanvasContents");
				addEdge(key);
				if (SemanticCanvasPlugin.isGroup(valArr)) return addGroup(key, valArr);
				/* If it's not a group, the array is of size 1 */
				const val = valArr[0];
				return addNode(val, firstColumnPosition);
			})

			thisFileNodeData.y = curY / 2 - thisFileNodeData.height / 2;

			return canvasContents

			/**
			 * Mutates canvasContents
			 * @param label 
			 */
			function addEdge(label: string): void {
				edgeCount = edgeCount + 1;
				canvasContents.edges.push({
					id: edgeCount.toString(),
					fromNode: '0',
					fromSide: 'right',
					toNode: (nodeCount + 1).toString(),
					toSide: 'left',
					label: label
				})
			}

			/**
			 * Mutates canvasContents
			 * @param val card text, url, file
			 * @param xPos also used as a flag for "is this in a group?"
			 */
			function addNode(val: string, xPos: number) {
				nodeCount = nodeCount + 1;
				const newNode: any = {
					id: nodeCount.toString(),
					x: xPos.toString(),
					y: curY.toString()
				}
				if (SemanticCanvasPlugin.isFile(val)) {
					newNode.type = 'file';
					newNode.file = val.substring(2, val.length - 2);
					newNode.width = 400;
					newNode.height = 400;
					if (that.app.vault.getAbstractFileByPath(newNode.file) === null) {
						//no such file exists, search for best match
						const splitToBaseAndAlias = newNode.file.split('|');
						const base = splitToBaseAndAlias[0];
						const splitToPathAndSubpath = base.split('#');
						const path = splitToPathAndSubpath[0];
						if (splitToPathAndSubpath.length > 1) newNode.subpath = "#" + splitToPathAndSubpath[1];
						const foundFile = that.app.metadataCache.getFirstLinkpathDest(path, file.path);
						if (foundFile !== null) newNode.file = foundFile.path;
						//else just leaving the link broken
					}
				} else if (SemanticCanvasPlugin.isURL(val)) {
					newNode.type = 'link';
					newNode.url = val;
					newNode.width = 400;
					newNode.height = 400;
				} else {
					newNode.type = 'text';
					newNode.text = val;
					newNode.width = val.length > 15 ? 400 : 200;
					newNode.height = val.length > 15 ? 200 : 100;
				}

				/* adjust curY based on height if this isn't being added in a group*/
				if (xPos === firstColumnPosition) {
					curY = curY + parseInt(newNode.height) + 50;
				}

				canvasContents.nodes.push(newNode as CanvasTextData);
				// Returning for use in "addGroup"
				return newNode
			}

			function addGroup(key: string, valArr: Array<string>) {
				nodeCount = nodeCount + 1;
				const newGroup: CanvasGroupData = {
					type: 'group',
					id: nodeCount.toString(),
					x: firstColumnPosition,
					y: curY,
					label: key,
					width: 50,
					height: 50
				}
				let xPos = firstColumnPosition + 50;
				curY = curY + 50;
				valArr.forEach(val => {
					let newNode = addNode(val, xPos);
					xPos = xPos + newNode.width + 50;
					newGroup.width = newGroup.width + newNode.width + 50;
					if (newNode.height + 100 > newGroup.height) newGroup.height = newNode.height + 100
				})
				curY = curY + newGroup.height;
				canvasContents.nodes.push(newGroup);
			}
		}

		function createSavePathBasedOnSettings(file: TFile, that: SemanticCanvasPlugin): string {
			let location = '';
			switch (that.settings.newFileLocation) {
				case Location.SameFolder:
					location = file.parent!.path;
					break;
				case Location.SpecifiedFolder:
					const fileLocationExists = that.app.vault.getAbstractFileByPath(that.settings.customFileLocation) !== null;
					if (fileLocationExists) {
						location = that.settings.customFileLocation;
					} else {
						new Notice(
							`folder ${that.settings.customFileLocation} does not exist, creating in root folder`
						);
					}
			}
			let canvasPath = name + '.canvas';
			if (location !== '') canvasPath = location + "/" + canvasPath;
			/* If the file already exists, keep appending "(new)" until it's unique */
			while (that.app.vault.getAbstractFileByPath(canvasPath) !== null) {
				canvasPath = canvasPath.substring(0, canvasPath.length - 7) + " (new).canvas"
			}
			return canvasPath
		}
	}

	static isGroup(val: Array<string>) {
		return val.length > 1;
	}

	static isFile(val: string): boolean {
		if (val.substring(0, 2) !== '[[') return false;
		if (val.substring(val.length - 2) !== ']]') return false;
		if (val.split('[[').length !== 2) return false;
		return true
	}

	static isURL(val: string): boolean {
		if (val.toUpperCase().substring(0, 4) !== 'HTTP') return false
		if (!val.contains('//')) return false
		if (val.length < 8) return false
		return true
	}

	/**
	 * The main function for using an existing canvas to update note properties.
	 * @param overwrite `true` will overwrite existing values for keys
	 */
	async pushCanvasToNoteProperties(overwrite: boolean, file?: TFile) {
		//@ts-expect-error
		if (file === undefined) file = this.app.workspace.getActiveFile();
		if (!file || file?.extension !== 'canvas') {
			new Notice('Aborted: Active file is not Canvas');
			return;
		}

		let data = await SemanticCanvasPlugin.getCanvasMap(file);

		if (!data) {
			new Notice('Aborted: No Canvas data found');
			return;
		}

		let fileNodes = data?.files?.map(file => new FileNode(file, data!, this.settings, this.app));

		/* De-dupe - if same file was on a canvas multiple times */
		let dedupedFileNodes: FileNode[] = [];
		fileNodes?.forEach(fileNode => {
			if (fileNode.propsOnCanvas === null) return

			let existing = dedupedFileNodes?.find(ogNodeList => ogNodeList.filePath === fileNode.filePath);

			if (existing === undefined) {
				dedupedFileNodes.push(fileNode);
				return
			}

			existing.propsOnCanvas = mergeProps(existing.propsOnCanvas, fileNode.propsOnCanvas);
		})

		/* Remove any unaffected nodes before seeking files */
		dedupedFileNodes = dedupedFileNodes.filter(fileNode => fileNode.propsOnCanvas && Object.keys(fileNode.propsOnCanvas).length > 0);

		let actualFilesMap: Array<any> = dedupedFileNodes.map(fileNode => {
			return {
				file: this.app.vault.getFileByPath(fileNode.filePath),
				props: fileNode.propsOnCanvas
			}
		});

		/* Remove any non-markdown files before setting properties */
		actualFilesMap = actualFilesMap.filter(fileMap => fileMap.file?.extension === 'md');

		let propertyAddCount = 0;
		actualFilesMap.forEach(fileMap => {
			propertyAddCount = propertyAddCount + Object.keys(fileMap.props).length
		})

		let modifiedFileCount = actualFilesMap.length;

		actualFilesMap.forEach(fileMap => this.app.fileManager.processFrontMatter(fileMap.file, (frontmatter) => {
			/* have to directly mutate this object, a bit tedious */
			Object.keys(fileMap.props).forEach(key => {
				if (overwrite || !frontmatter.hasOwnProperty(key)) {
					frontmatter[key] = fileMap.props[key];
					return
				}

				//force array
				if (!Array.isArray(frontmatter[key])) frontmatter[key] = [frontmatter[key]];
				/* Don't add duplicate values to existing props */
				fileMap.props[key] = fileMap.props[key].filter((val: any) => !frontmatter[key].some((og: any) => og === val))
				frontmatter[key] = [...frontmatter[key], ...fileMap.props[key]];
			})

		}));

		if (modifiedFileCount > 0) {
			new Notice(`Successfully set ${propertyAddCount} prop(s) in ${modifiedFileCount} file(s)`)
		} else {
			new Notice(`No notes connections found on canvas.`)
		}

		function mergeProps(a: any, b: any) {
			Object.keys(b).forEach(key => {
				if (a.hasOwnProperty(key)) {
					a[key] = [...a[key], ...b[key]];
				} else {
					a[key] = b[key];
				}
			})
			return a;
		}
	}

	/**
	 * Creates a new node in the file represented inside the passed-in File view & saves it
	 * @param text property value from the note
	 * @param label the key the value has in the note
	 * @param x where to put the new node
	 * @param y where to put the new node
	 */
	async addNodeDataAtLocation(fileView: TextFileView, textArr: string[], label: string, x: number, y: number, fromNode: CanvasNodeData) {
		if (fileView.file === null) throw new Error('fileView had no associated file');
		const visibleCanvasData = JSON.parse(fileView.data) as CanvasData

		//making "that" reference for use by makeNodeOrGroupOfNodesFor
		const that = this;
		const newNodeOrGroup = makeNodeOrGroupOfNodesFor(textArr, label);
		visibleCanvasData.nodes.push(...newNodeOrGroup);

		const fromToSides = SemanticCanvasPlugin.determineSides(fromNode, newNodeOrGroup[0] as never as CanvasNodeData);
		visibleCanvasData.edges.push({
			id: (Math.random() + 1).toString(36).substring(4),
			fromNode: fromNode.id,
			fromSide: fromToSides.from,
			toNode: newNodeOrGroup[0].id,
			toSide: fromToSides.to,
			label: label
		})

		// save to file
		await this.app.vault.modify(fileView.file, JSON.stringify(visibleCanvasData));

		function makeNodeOrGroupOfNodesFor(propVals: string[], label: string): AllCanvasNodeData[] {
			const returnObj: AllCanvasNodeData[] = [];

			propVals.forEach(text => {
				let newNode: any = {
					id: (Math.random() + 1).toString(36).substring(4),
					x: x - 100,
					y: y - 50 + (110 * returnObj.length),
					width: 200,
					height: 100,
				}

				const isfile = SemanticCanvasPlugin.isFile(text);
				newNode.type = isfile ? 'file' : 'text';
				if (isfile) {
					//need to convert from wikilink style to absolute path
					const linkSansBrackets = text.substring(2, text.length - 2);
					const foundFile = that.app.metadataCache.getFirstLinkpathDest(linkSansBrackets, fileView!.file!.path);
					if (foundFile !== null) {
						newNode.file = foundFile.path;
					}
					if (foundFile === null) {
						//fallback to card with wikilink
						newNode.type = 'text';
						newNode.text = text;
					}
				}
				if (!isfile) newNode.text = text;
				returnObj.push(newNode);
			})
			//if more than one propVal got passed in, need to make a group to contain them
			if (propVals.length > 1) {
				let newNode: any = {
					id: (Math.random() + 1).toString(36).substring(4),
					x: x - 110,
					y: y - 60,
					width: 220,
					height: 10 + (110 * returnObj.length),
					type: 'group',
					label: label
				}
				returnObj.unshift(newNode);
			}
			return returnObj;
		}
	}

	/**
	 * The main function for using an existing canvas to update note properties.
	 * @param overwrite `true` will overwrite existing values for keys
	 */
	async pullNotePropertiesToCanvas(fileView: TextFileView, nodesToPullFrom: CanvasNodeData[], existingOnly = false) {

		if (fileView.file === null) throw new Error('fileView had no associated file');
		const visibleCanvasData = JSON.parse(fileView.data) as CanvasData

		const canvasMap = await SemanticCanvasPlugin.getCanvasMap(fileView.file);

		if (canvasMap === undefined) throw new Error("Canvas Map was unable to be created");

		let connectionTargets = this.buildConnectionTargets(canvasMap);

		let edgesToBuild: CanvasEdgeData[] = [];
		let nodesToBuild: AllCanvasNodeData[] = [];
		nodesToPullFrom.forEach((node: any) => {
			console.log(node)
			let noteProps = this.getNoteData(typeof node.file === 'string' ? node.file : node.file.path);
			console.log(noteProps)
			noteProps.forEach(prop => {
				const key = Object.keys(prop)[0];
				const vals = prop[key];
				vals.forEach(val => {
					let connection = connectionTargets.find(target => target.content === val || (target.normalizedFileName && target.normalizedFileName! === val));
					//create edges & nodes when no matching node is found
					if (connection === undefined) {
						if (existingOnly) return;
						let newNode: any = {
							id: (Math.random() + 1).toString(36).substring(4),
							x: Number.parseFloat(node.x) + Number.parseFloat(node.width) + 20,
							y: Number.parseFloat(node.y) + (Number.parseFloat(node.height) + 20) * nodesToBuild.length,
							width: node.width,
							height: node.height,
							label: key
						}

						const isfile = SemanticCanvasPlugin.isFile(val);
						newNode.type = isfile ? 'file' : 'text';
						if (isfile) {
							//need to convert from wikilink style to absolute path
							const linkSansBrackets = val.substring(2, val.length - 2);
							const foundFile = this.app.metadataCache.getFirstLinkpathDest(linkSansBrackets, fileView!.file!.path);
							if (foundFile !== null) newNode.file = foundFile.path;
							if (foundFile === null) {
								//fallback to card with wikilink
								newNode.type = 'text';
								newNode.text = val;
							}
						}
						if (!isfile) newNode.text = val;

						nodesToBuild.push(newNode);
						edgesToBuild.push({
							id: (Math.random() + 1).toString(36).substring(4),
							fromNode: node.id,
							fromSide: 'right',
							toNode: newNode.id,
							toSide: 'left',
							label: key
						})
						return;
					}
					//don't create edges that already exist
					if (edgeAlreadyExists(node.id, connection.id, key)) return

					//only create edge when matching node is found
					const fromToSides = SemanticCanvasPlugin.determineSides(node, connection as never as CanvasNodeData);
					edgesToBuild.push({
						id: (Math.random() + 1).toString(36).substring(4),
						fromNode: node.id,
						fromSide: fromToSides.from,
						toNode: connection.id,
						toSide: fromToSides.to,
						label: key
					})
				})
			})
		})

		console.log(edgesToBuild, nodesToBuild)

		// push new edges & nodes to the canvas data
		visibleCanvasData.edges.push(...edgesToBuild);
		visibleCanvasData.nodes.push(...nodesToBuild);
		// save to file
		await this.app.vault.modify(fileView.file, JSON.stringify(visibleCanvasData));

		return

		function edgeAlreadyExists(fromId: string, toId: string, labeled: string): boolean {
			return visibleCanvasData.edges.some(edge => edge.fromNode === fromId && edge.toNode === toId && edge.label === labeled)
		}

	}

	static determineSides(fromNode: CanvasNodeData, toNode: CanvasNodeData): { from: NodeSide, to: NodeSide } {
		let verticalDelta = fromNode.y - toNode.y;
		let horizontalDelta = fromNode.x - toNode.x;
		if (Math.abs(verticalDelta) > Math.abs(horizontalDelta)) {
			if (verticalDelta > 0) return { from: 'top', to: 'bottom' }
			return { from: 'bottom', to: 'top' }
		}
		if (horizontalDelta > 0) return { from: 'left', to: 'right' }
		return { from: 'right', to: 'left' }
	}

	/**
	 * Gets the **list type** properties from the passed-in note file
	 * @param file the .md file to get properties from
	 * @returns list-type properties map
	 */
	getNoteData(filepath: string): Array<{ [index: string]: Array<string> }> {
		// console.log(file);

		const allProperties = this.app.metadataCache.getCache(filepath)?.frontmatter;
		let listTypeProps: Array<{ [index: string]: Array<string> }> = [];

		const includeAlias = this.settings.includeAlias;

		if (allProperties !== undefined) {
			Object.keys(allProperties).forEach((key) => {
				if (!includeAlias && (key === 'alias' || key === 'aliases')) return
				if (Array.isArray(allProperties[key])) listTypeProps.push({ [key]: allProperties[key] });
			})
		}
		return listTypeProps;
	}

	/**
	 * Creates a list of pre-existing things on a canvas that a hypothetical node
	 * *could* link to if it's looking for links. 
	 * Content is returned a key:value pair where the key is the node id 
	 * and the value is a string-based representation of the content for comparison
	 * @param nodes 
	 */
	buildConnectionTargets(nodes: CanvasMap) {
		let returnArray: {
			nodeType: "card" | "file" | "url" | "group",
			id: string,
			content: string
			normalizedFileName?: string,
			x: number,
			y: number,
			w: number,
			h: number
		}[] = [];

		nodes.cards?.forEach(card => {
			returnArray.push({
				nodeType: 'card',
				id: card.id,
				content: card.text,
				x: card.x,
				y: card.y,
				w: card.width,
				h: card.height
			})
		});
		nodes.files?.forEach(file => {
			const filename = file.file;
			const filenameAsWikiLink = "[[" + file.file.split('/').pop()!.substring(0, file.file.split('/').pop()!.length - 3) + "]]";
			returnArray.push({
				nodeType: 'file',
				id: file.id,
				content: filename,
				normalizedFileName: filenameAsWikiLink,
				x: file.x,
				y: file.y,
				w: file.width,
				h: file.height
			})
		});
		nodes.urls?.forEach(url => {
			returnArray.push({
				nodeType: 'url',
				id: url.id,
				content: url.url,
				x: url.x,
				y: url.y,
				w: url.width,
				h: url.height
			})
		});

		/* --- actually not doing this. Groups are always janky no matter what.
		nodes.groups?.forEach(group => {
			//sort group to ensure consistency for comparison sake
			const sortedGroup = group.containedNodes.sort((nodeA: any, nodeB: any) => {
				let valueA = getDisplayValue(nodeA);
				let valueB = getDisplayValue(nodeB);
				return valueA > valueB ? 1 : -1;
				// function getDisplayValue(nodeData: any) {
				// 	if (nodeData.type === 'text') return nodeData.text
				// 	if (nodeData.type === 'file') return nodeData.file
				// 	if (nodeData.type === 'link') return nodeData.url
				// 	if (nodeData.type === 'group') return ''
				// }	
			})
			const sortedGroupVals = sortedGroup.map((member: any) => getDisplayValue(member)) as string[]
			returnArray.push({
				nodeType: 'group',
				id: group.id,
				content: sortedGroupVals.join('|||'),
				x: group.x,
				y: group.y,
				w: group.width,
				h: group.height
			})
		})
		*/

		return returnArray


	}

	static async getCanvasData(file: TFile | null): Promise<RawCanvasObj | undefined> {
		if (file === null || file.extension !== 'canvas') return;
		let rawCanvasText = await file.vault.cachedRead(file);
		let canvas = JSON.parse(rawCanvasText);
		return canvas!
	}

	static getCanvasNodes(data: RawCanvasObj): CanvasMap | undefined {
		if (data === undefined) return undefined;
		let map: CanvasNodeMap = {
			cards: (<CanvasTextData[]>data.nodes.filter((node) => node.type == 'text')),
			files: (<CanvasFileData[]>data.nodes.filter((node) => node.type == 'file')),
			urls: (<CanvasLinkData[]>data.nodes.filter((node) => node.type == 'link')),
			groups: (<CanvasGroupData[]>data.nodes.filter((node) => node.type == 'group')),
		}

		/* Find wholly-contained file-type nodes & add to group */
		map.groups?.forEach((group) => {
			group.containedNodes = [] as CanvasNodeData[];
			map.files?.forEach((file) => {
				if (groupContainsNode(group, file)) {
					group.containedNodes.push(file);
					if (file.hasOwnProperty('inGroups')) {
						file.inGroups.push(group)
					} else {
						file.inGroups = [group];
					}
				}
			})
			map.cards?.forEach((cards) => {
				if (groupContainsNode(group, cards)) {
					group.containedNodes.push(cards);
				}
			})
			map.urls?.forEach((urls) => {
				if (groupContainsNode(group, urls)) {
					group.containedNodes.push(urls);
				}
			})
		})

		/**
		 * Returns true if the Group's outer bounds wholly contain the file's outer bounds.
		 * Mimicks the behavior in Obsidian
		 * @param group 
		 * @param node 
		 */
		function groupContainsNode(group: CanvasGroupData, node: CanvasNodeData): boolean {
			if (group.y > node.y) return false
			if (group.y + group.height < node.y + node.height) return false
			if (group.x > node.x) return false
			if (group.x + group.width < node.x + node.width) return false
			return true;
		}

		return map;
	}

	static getCanvasEdges(data: RawCanvasObj): CanvasEdgeData[] | undefined {
		if (data === undefined) return undefined;
		data.edges.forEach(edge => {
			edge.isBidirectional = (edge.fromEnd === 'arrow' || edge.toEnd === 'none')
		})
		return data.edges
	}

	static async getCanvasMap(file: TFile | null): Promise<CanvasMap | undefined> {
		if (!file) return undefined;

		const canvasData = await SemanticCanvasPlugin.getCanvasData(file);
		if (!canvasData) return undefined;

		let map = SemanticCanvasPlugin.getCanvasNodes(canvasData)
		if (!map) return undefined;

		let edges = SemanticCanvasPlugin.getCanvasEdges(canvasData)
		map!.edges = edges as unknown as Array<CanvasEdgeData & { isBidirectional: boolean }>;

		edges?.forEach(edge => {
			const toType = getTypeOfNodeById(edge.toNode);

			if (toType === 'group') {
				/* create phantom edges to group contents */
				let group = map?.groups?.find(g => g.id === edge.toNode);
				if (!group) throw new Error('Unmatched group. ID: ' + edge.toNode);
				makePhantomPropagatedEdgesToGroupContents(group!, edge);
			}
		})

		return map

		function getTypeOfNodeById(nodeId: string) {
			if (map?.cards?.some(card => card.id === nodeId)) return 'card'
			if (map?.files?.some(file => file.id === nodeId)) return 'file'
			if (map?.urls?.some(url => url.id === nodeId)) return 'url'
			if (map?.groups?.some(group => group.id === nodeId)) return 'group'
			throw new Error('No type found for id: ' + nodeId);
		}

		/**
		 * Mutates the map to set its edges property to the passed-in edges AND
		 * the "phantom" edges created by links-to-groups.
		 * @param map 
		 * @param edges 
		 */
		function makePhantomPropagatedEdgesToGroupContents(group: CanvasGroupData, edge: CanvasEdgeData) {
			group.containedNodes.forEach((node: CanvasNodeData) => {
				if (node.type === 'group') return //if a group contains another group, that group node can be ignored

				const newEdge: CanvasEdgeData = {
					id: edge.id + '-phantom',
					fromNode: edge.fromNode,
					fromSide: 'right', //doesn't matter
					toNode: node.id,
					toSide: 'left', //doesn't matter
					label: edge.hasOwnProperty('label') ? edge.label : group.label
				}

				edges?.push(newEdge);
			})
		}
	}

	onunload() {
		//nothing to do
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SemanticCanvasSettingsTab extends PluginSettingTab {
	plugin: SemanticCanvasPlugin;

	constructor(app: App, plugin: SemanticCanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		/* Clear existing content, if any */
		containerEl.empty();

		containerEl.createEl('h1', { text: 'Note → create canvas' });
		new Setting(containerEl)
			.setName('Default location for new canvas files')
			.addDropdown((dropDown) => {
				dropDown
					.addOption(Location[Location.VaultFolder], 'Vault folder')
					.addOption(
						Location[Location.SameFolder],
						'Same folder as current file'
					)
					.addOption(
						Location[Location.SpecifiedFolder],
						'In the folder specified below'
					)
					.setValue(
						Location[this.plugin.settings.newFileLocation] ||
						Location[Location.VaultFolder]
					)
					.onChange(async (value) => {
						this.plugin.settings.newFileLocation =
							Location[value as keyof typeof Location];
						await this.plugin.saveSettings();
						this.display();
					});
			});
		if (this.plugin.settings.newFileLocation == Location.SpecifiedFolder) {
			new Setting(containerEl)
				.setName('Folder to create new canvas files in')
				.addText((text) => {
					text
						.setPlaceholder('Example: folder 1/folder 2')
						.setValue(this.plugin.settings.customFileLocation)
						.onChange(async (value) => {
							this.plugin.settings.customFileLocation = value;
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl)
			.setName('Create nodes for "Alias" property values')
			.setDesc(`When populating a canvas based on a note's properties, should the "alias" property create nodes. Default: false`)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeAlias)
				.onChange(async (value) => {
					this.plugin.settings.includeAlias = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h1', { text: 'Canvas → set note properties' });
		containerEl.createEl('h2', { text: 'Toggle property setting per type' });
		new Setting(containerEl)
			.setName('Set note properties for connections to cards ')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useCards)
				.onChange(async (value) => {
					this.plugin.settings.useCards = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Set note properties for connections to urls')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useUrls)
				.onChange(async (value) => {
					this.plugin.settings.useUrls = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Set note properties for connections to files')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useFiles)
				.onChange(async (value) => {
					this.plugin.settings.useFiles = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Set note properties based on containment in groups')
			.setDesc('Default: false')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useGroups)
				.onChange(async (value) => {
					this.plugin.settings.useGroups = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h2', { text: 'Default property keys for unlabeled connections' });
		new Setting(containerEl)
			.setName('Property key for unlabeled connections to: cards')
			.setDesc('Leave blank to only create properties for labeled edges. Default: cards')
			.addText(text => text
				.setPlaceholder('Default cards key...')
				.setValue(this.plugin.settings.cardDefault)
				.onChange(async (value) => {
					this.plugin.settings.cardDefault = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Property key for unlabeled connections to: urls')
			.setDesc('Leave blank to only create properties for labeled edges. Default: urls')
			.addText(text => text
				.setPlaceholder('Default urls key...')
				.setValue(this.plugin.settings.urlDefault)
				.onChange(async (value) => {
					this.plugin.settings.urlDefault = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Property key for unlabeled connections to: files')
			.setDesc('Leave blank to only create properties for labeled edges. Default: files')
			.addText(text => text
				.setPlaceholder('Default files key...')
				.setValue(this.plugin.settings.fileDefault)
				.onChange(async (value) => {
					this.plugin.settings.fileDefault = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h2', { text: 'Property keys for group containment' });
		new Setting(containerEl)
			.setName('Property key for unlabeled groups')
			.setDesc('Default: groups')
			.addText(text => text
				.setPlaceholder('Default groups key...')
				.setValue(this.plugin.settings.groupDefault)
				.onChange(async (value) => {
					this.plugin.settings.groupDefault = value;
					await this.plugin.saveSettings();
				}));
	}
}


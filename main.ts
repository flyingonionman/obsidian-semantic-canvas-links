import { App, MetadataCache, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder, getFrontMatterInfo } from 'obsidian';
import { CanvasData, CanvasEdgeData, CanvasFileData, CanvasGroupData, CanvasLinkData, CanvasNodeData, CanvasTextData } from 'canvas';

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
	useGroups: true
}

/**
 * Represents an instance of a node on the canvas that represents a file in the vault
 */
class FileNode {
	filePath: string;
	propsToSet: any;
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
		this.propsToSet = {};
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
			this.propsToSet = null;
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
			this.propsToSet[settings.groupDefault] = file.inGroups.map((group: CanvasGroupData) => group.label);
		}

		/* this -> card */
		if (settings.useCards) {
			edges.filter(edge => edge.type === 'card').forEach(edge => {
				if (!this.propsToSet.hasOwnProperty(edge.propLbl)) {
					this.propsToSet[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsToSet[edge.propLbl!].push(edge.propVal);
			})
		}

		/* this -> url */
		if (settings.useUrls) {
			edges.filter(edge => edge.type === 'url').forEach(edge => {
				if (!this.propsToSet.hasOwnProperty(edge.propLbl)) {
					this.propsToSet[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsToSet[edge.propLbl!].push(edge.propVal);
			})
		}
		/* this -> note */
		if (settings.useFiles) {
			edges.filter(edge => edge.type === 'file').forEach(edge => {
				if (!this.propsToSet.hasOwnProperty(edge.propLbl)) {
					this.propsToSet[edge.propLbl!] = [edge.propVal];
					return
				}
				this.propsToSet[edge.propLbl!].push(edge.propVal);
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

		/* This command will add new values onto the end of an already-existing property */
		this.addCommand({
			id: 'create-canvas-from-note',
			name: 'Create canvas based on note',
			callback: () => {
				this.createCanvasFromNote();
			}
		});

		this.addSettingTab(new SemanticCanvasSettingsTab(this.app, this));

		/* File Menu */
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFolder || file === undefined) return;
				/* If Markdown offer to create canvas */
				if ((<TFile>file).extension === 'md') {
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
		let listTypeProps: Array<{ [index: string]: Array<string> }> = [];

		if (allProperties !== undefined) {
			Object.keys(allProperties).forEach((key) => {
				if (Array.isArray(allProperties[key])) listTypeProps.push({ [key]: allProperties[key] });
			})
		}

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
				if (isGroup(valArr)) return addGroup(key, valArr);
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
				if (isFile(val)) {
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
				} else if (isURL(val)) {
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

			function isGroup(val: Array<string>) {
				return val.length > 1;
			}

			function isFile(val: string): boolean {
				if (val.substring(0, 2) !== '[[') return false;
				if (val.substring(val.length - 2) !== ']]') return false;
				if (val.split('[[').length !== 2) return false;
				return true
			}

			function isURL(val: string): boolean {
				if (val.toUpperCase().substring(0, 4) !== 'HTTP') return false
				if (!val.contains('//')) return false
				if (val.length < 8) return false
				return true
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
			if (fileNode.propsToSet === null) return

			let existing = dedupedFileNodes?.find(ogNodeList => ogNodeList.filePath === fileNode.filePath);

			if (existing === undefined) {
				dedupedFileNodes.push(fileNode);
				return
			}

			existing.propsToSet = mergeProps(existing.propsToSet, fileNode.propsToSet);
		})

		/* Remove any unaffected nodes before seeking files */
		dedupedFileNodes = dedupedFileNodes.filter(fileNode => fileNode.propsToSet && Object.keys(fileNode.propsToSet).length > 0);

		let actualFilesMap: Array<any> = dedupedFileNodes.map(fileNode => {
			return {
				file: this.app.vault.getFileByPath(fileNode.filePath),
				props: fileNode.propsToSet
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
			.setDesc('Default: true')
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
			.setName('Property key for groups')
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


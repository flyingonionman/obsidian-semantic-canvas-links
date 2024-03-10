import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { CanvasEdgeData, CanvasFileData, CanvasGroupData, CanvasLinkData, CanvasNodeData, CanvasTextData } from 'canvas';

interface SemanticCanvasPluginSettings {
	cardDefault: string;
	fileDefault: string;
	urlDefault: string;
	groupDefault: string;
	useCards: boolean;
	useUrls: boolean;
	useFiles: boolean;
	useGroups: boolean;
}

interface CanvasNodeMap {
	cards?: Array<CanvasTextData>,
	files?: Array<CanvasFileData> & { inGroups?: Array<CanvasGroupData> },
	links?: Array<CanvasLinkData>,
	groups?: Array<CanvasGroupData & { containedFiles?: Array<CanvasFileData> }>
}

interface CanvasMap extends CanvasNodeMap {
	edges?: Array<CanvasEdgeData & {isBidirectional: boolean}>
}

type ConnectionProps = {
	otherSideId?: string;
	otherSide?: CanvasNodeData
	type?: 'card' | 'url' | 'file' | 'group';
	isBidirectional?: boolean;
	propLbl?: string;
	propVal?: string;
}

const DEFAULT_SETTINGS: SemanticCanvasPluginSettings = {
	cardDefault: 'cards',
	fileDefault: 'files',
	urlDefault: 'urls',
	groupDefault: 'groups',
	useCards: true,
	useUrls: true,
	useFiles: true,
	useGroups: true
}

class FileNode {
	filePath: string;
	propsToSet: any;

	constructor(file: CanvasFileData, data: CanvasMap, settings: SemanticCanvasPluginSettings) {
		this.filePath = file.file;
		this.propsToSet = {};
		if (file.inGroups === undefined) file.inGroups = [];

		let relevantIds = [file.id];
		relevantIds = [file.id, ...file.inGroups.map((g: any) => g.id)];

		//#TODO - swap data.edges here with something that switches group IDs with a list of contained items

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
				newEdge.otherSide = data.links?.find(url => url.id === newEdge.otherSideId);
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
			if (newEdge.type === 'file') newEdge.propVal = convertToWikilink(newEdge.otherSide.file);
			if (edge.label !== undefined) newEdge.propLbl = edge.label;
			return newEdge
		})!

		// console.log(relevantEdges);

		/* ALL PROPERTIES MUST BE ARRAYS OF STRINGS*/

		/* this contained in group */
		if (file.inGroups.length > 0 && settings.useGroups) {
			this.propsToSet[settings.groupDefault] = file.inGroups.map((group: CanvasGroupData) => group.label);
		}
		
		/* this -> group */


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
				
				/* Handle bi-directionality */
				// if(edge.isBidirectional){
					
				// }
			})
		}

		function convertToWikilink(filepath: string): string {
			let split = filepath.split('.');
			if(split[split.length-1] === 'md'){
				let sansExtension = split.slice(0,-1);
				split = sansExtension;
			}
			let noteRefString = split.join('.');
			return "[[" + noteRefString + "]]";
		}
	}
}

export default class SemanticCanvasPlugin extends Plugin {
	settings: SemanticCanvasPluginSettings;

	async onload() {
		await this.loadSettings();

		// this.registerEvent(
		// 	this.app.workspace.on("editor-menu", (menu) => {
		// 		console.log(menu)
		// menu.addItem((item) => {
		// 	item.setTitle('NOTE CONTEXT MENU CUSTOM ACTION')
		// 		.setIcon('cloud')
		// 		.onClick(() => {
		// 			//@ts-ignore
		// 			this.app.commands.executeCommandById(command.id);
		// 		});
		// });
		// 	})
		// );

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('right-arrow-with-tail', 'Push Canvas to Note Properties', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.pushCanvasToNoteProperties(true);
		});

		// Perform additional things with the ribbon
		// ribbonIconEl.addClass('my-plugin-ribbon-class'); // never figured out what this line did, seemingly nothing

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		/* This adds a simple command that can be triggered anywhere */
		this.addCommand({
			id: 'set-canvas-to-note-properties',
			name: 'Overwrite Note Properties based on Canvas',
			callback: () => {
				// new SampleModal(this.app).open();
				this.pushCanvasToNoteProperties(true);
			}
		});

		/* This adds a simple command that can be triggered anywhere */
		this.addCommand({
			id: 'append-canvas-to-note-properties',
			name: 'Append Nope Properties based on Canvas',
			callback: () => {
				// new SampleModal(this.app).open();
				this.pushCanvasToNoteProperties(false);
			}
		});

		// This adds an editor command that can perform some operation on the current editor instance
		// this.addCommand({
		// 	id: 'sample-editor-command',
		// 	name: 'Sample editor command',
		// 	editorCallback: (editor: Editor, view: MarkdownView) => {
		// 		console.log(editor.getSelection());
		// 		editor.replaceSelection('Sample Editor Command');
		// 	}
		// });

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		// this.addCommand({
		// 	id: 'open-sample-modal-complex',
		// 	name: 'Open sample modal (complex)',
		// 	checkCallback: (checking: boolean) => {
		// 		// Conditions to check
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			console.log(markdownView);

		// 			// If checking is true, we're simply "checking" if the command can be run.
		// 			// If checking is false, then we want to actually perform the operation.
		// 			if (!checking) {
		// 				new SampleModal(this.app).open();
		// 			}

		// 			// This command will only show up in Command Palette when the check function returns true
		// 			return true;
		// 		}
		// 	}
		// });

		/* This adds a settings tab so the user can configure various aspects of the plugin */
		this.addSettingTab(new MySettingsTab(this.app, this));
	}

	async pushCanvasToNoteProperties(overwrite: boolean) {
		let file = this.app.workspace.getActiveFile();
		if (!file || file?.extension !== 'canvas') {
			new Notice('Aborted: Active file is not Canvas');
			return;
		}

		let data = await SemanticCanvasPlugin.getCanvasMap(file);

		// console.log(data);

		if (!data) {
			new Notice('Aborted: No Canvas data found');
			return;
		}

		let fileNodes = data?.files?.map(file => new FileNode(file, data!, this.settings));

		console.log(fileNodes);

		/* De-dupe - if same file was on a canvas multiple times */
		let dedupedFileNodes: FileNode[] = [];
		fileNodes?.forEach(fileNode => {
			let existing = dedupedFileNodes?.find(ogNodeList => ogNodeList.filePath === fileNode.filePath);
			if (existing === undefined) {
				dedupedFileNodes.push(fileNode);
				return
			}
			// console.log(existing, fileNode);
			if(fileNode.propsToSet !== null) existing.propsToSet = mergeProps(existing.propsToSet, fileNode.propsToSet);
		})

		/* Remove any unaffected nodes before seeking files */
		dedupedFileNodes = dedupedFileNodes.filter(fileNode => fileNode.propsToSet && Object.keys(fileNode.propsToSet).length > 0);

		// console.log(dedupedFileNodes);

		let actualFilesMap: Array<any> = dedupedFileNodes.map(fileNode => {
			return {
				file: this.app.vault.getFileByPath(fileNode.filePath),
				props: fileNode.propsToSet
			}
		});

		/* Remove any non-markdown files before setting properties */
		actualFilesMap = actualFilesMap.filter(fileMap => fileMap.file?.extension === 'md');

		// console.log(actualFilesMap);

		let propertyAddCount = 0;
		actualFilesMap.forEach(fileMap => {
			propertyAddCount = propertyAddCount + Object.keys(fileMap.props).length
		})

		let modifiedFileCount = actualFilesMap.length;

		actualFilesMap.forEach(fileMap => this.app.fileManager.processFrontMatter(fileMap.file, (frontmatter) => {
			/* have to directly mutate this object, a bit tedious */
			Object.keys(fileMap.props).forEach(key => {
				if(overwrite || !frontmatter.hasOwnProperty(key)) {
					frontmatter[key] = fileMap.props[key];
					return
				}

				//force array
				if (!Array.isArray(frontmatter[key])) frontmatter[key] = [frontmatter[key]];

				fileMap.props[key] = fileMap.props[key].filter((val:any)=>!frontmatter[key].some((og:any)=>og===val))
				frontmatter[key] = [...frontmatter[key], ...fileMap.props[key]];
			})

		}));

		new Notice(`Successfully set ${propertyAddCount} prop(s) in ${modifiedFileCount} file(s)`)

		function mergeProps(a: any, b: any) {
			Object.keys(b).forEach(key => {
				if (a.hasOwnProperty(key)) a[key] = [...a[key], ...b[key]];
			})
			return a;
		}
	}

	static async getCanvasData(file: TFile | null): Promise<{ nodes: Array<CanvasNodeData>, edges: Array<CanvasEdgeData> } | undefined> {
		if (file === null || file.extension !== 'canvas') return;
		let rawCanvasText = await file.vault.cachedRead(file);
		let canvas = JSON.parse(rawCanvasText);
		return canvas
	}

	static async getCanvasNodes(file: TFile | null): Promise<CanvasNodeMap | undefined> {
		let data = await SemanticCanvasPlugin.getCanvasData(file);
		if (data === undefined) return undefined;
		let map: CanvasNodeMap = {
			cards: (<CanvasTextData[]>data.nodes.filter((node) => node.type == 'text')),
			files: (<CanvasFileData[]>data.nodes.filter((node) => node.type == 'file')),
			links: (<CanvasLinkData[]>data.nodes.filter((node) => node.type == 'link')),
			groups: (<CanvasGroupData[]>data.nodes.filter((node) => node.type == 'group')),
		}

		/* Find wholly-contained file-type nodes & add to group */
		map.groups?.forEach((group) => {
			let filesToAdd: CanvasFileData[] = [];
			map.files?.forEach((file) => {
				if (groupContainsFile(group, file)) {
					filesToAdd.push(file);
					if (file.hasOwnProperty('inGroups')) {
						file.inGroups.push(group)
					} else {
						file.inGroups = [group];
					}
				}
			})
			group.containedFiles = filesToAdd;
		})

		/**
		 * Returns true if the Group's outer bounds wholly contain the file's outer bounds.
		 * Mimicks the behavior in Obsidian
		 * @param group 
		 * @param file 
		 */
		function groupContainsFile(group: CanvasGroupData, file: CanvasFileData): boolean {
			if (group.y > file.y) return false
			if (group.y + group.height < file.y + file.height) return false
			if (group.x > file.x) return false
			if (group.x + group.width < file.x + file.width) return false
			return true;
		}

		return map;
	}

	static async getCanvasEdges(file: TFile | null): Promise<CanvasEdgeData[] | undefined> {
		let data = await SemanticCanvasPlugin.getCanvasData(file);
		if (data === undefined) return undefined;
		data.edges.forEach(edge=>{
			edge.isBidirectional = (edge.fromEnd === 'arrow' || edge.toEnd === 'none')
		})
		return data.edges
	}

	static async getCanvasMap(file: TFile | null): Promise<CanvasMap | undefined> {
		if (!file) return undefined;

		let map: CanvasMap | undefined;
		let edges: CanvasEdgeData[] | undefined;

		await Promise.all([
			map = await SemanticCanvasPlugin.getCanvasNodes(file),
			edges = await SemanticCanvasPlugin.getCanvasEdges(file),
		])

		if (!map) return undefined;

		map!.edges = edges as unknown as Array<CanvasEdgeData & {isBidirectional: boolean}>;

		return map
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// class SampleModal extends Modal {
// 	constructor(app: App) {
// 		super(app);
// 	}

// 	onOpen() {
// 		const { contentEl } = this;
// 		contentEl.setText('Your vault is: ' + app.vault.getName());
// 	}

// 	onClose() {
// 		const { contentEl } = this;
// 		contentEl.empty();
// 	}
// }

class MySettingsTab extends PluginSettingTab {
	plugin: SemanticCanvasPlugin;

	constructor(app: App, plugin: SemanticCanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		/* Clear existing content, if any */
		containerEl.empty();

		new Setting(containerEl)
			.setName('Set note properties for connections to Cards ')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useCards)
				.onChange(async (value) => {
					this.plugin.settings.useCards = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Property Label for connections to Cards')
			.setDesc('Leave blank to only create properties for labeled edges. Default: cards')
			.addText(text => text
				.setPlaceholder('cards')
				.setValue(this.plugin.settings.cardDefault)
				.onChange(async (value) => {
					this.plugin.settings.cardDefault = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Set note properties for connections to Web Embeds ')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useUrls)
				.onChange(async (value) => {
					this.plugin.settings.useUrls = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Property Label for connections to Urls')
			.setDesc('Leave blank to only create properties for labeled edges. Default: urls')
			.addText(text => text
				.setPlaceholder('urls')
				.setValue(this.plugin.settings.urlDefault)
				.onChange(async (value) => {
					this.plugin.settings.urlDefault = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Set note properties for connections to Files')
			.setDesc('Default: true')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useFiles)
				.onChange(async (value) => {
					this.plugin.settings.useFiles = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Property Label for connections to Files')
			.setDesc('Leave blank to only create properties for labeled edges. Default: files')
			.addText(text => text
				.setPlaceholder('files')
				.setValue(this.plugin.settings.fileDefault)
				.onChange(async (value) => {
					this.plugin.settings.fileDefault = value;
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

		new Setting(containerEl)
			.setName('Default Property Label for containment in Groups')
			.setDesc('Default: groups')
			.addText(text => text
				.setPlaceholder('groups')
				.setValue(this.plugin.settings.groupDefault)
				.onChange(async (value) => {
					this.plugin.settings.groupDefault = value;
					await this.plugin.saveSettings();
				}));
	}
}

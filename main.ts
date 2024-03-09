import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { CanvasEdgeData, CanvasFileData, CanvasGroupData, CanvasLinkData, CanvasNodeData, CanvasTextData } from 'canvas';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

interface CanvasNodeMap{
	cards?: Array< CanvasTextData >,
	files?: Array< CanvasFileData >,
	links?: Array< CanvasLinkData >,
	groups?: Array< CanvasGroupData >
}

interface CanvasMap extends CanvasNodeMap{
	edges?: Array< CanvasEdgeData >
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class CanvasPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Hello world, from a Notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			// console.log('clicked, silently', evt);

			/* Says the File's name!*/
			let file = this.app.workspace.getActiveFile();
			// console.log(file?.path);
			// console.log(new Date(file!.stat.ctime).toDateString());
			// console.log(`The file is ${file?.stat.size} bytes in size`);

			/* Appends '... you know?' to the end of a note */
			// addYouKnow(file!);
			// this.addProperty(file!);

			// let files = this.app.vault.getFileByPath('Note A.md');
			// console.log(files);

			// await getNodes(file)

			// await this.getFrontMatterObj(file);

			let data = await CanvasPlugin.getCanvasMap(file);
			console.log(data);
			
		});

		// a silly simple appending function
		// function addYouKnow(file: TFile) {
		// 	file.vault.process(file, (data) => {
		// 		return data + "... you know?"
		// 	})
		// }

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	async getFrontMatterObj(file: TFile | null) {
		if (file === null) return;
		let fm: any;
		file.vault
		await this.app.fileManager.processFrontMatter(file, (data: any) => {
			fm = data;
		})
		return fm
	}

	addProperty = (file: TFile) => {
		this.app.fileManager.processFrontMatter(file, (fm) => {
			// console.log(fm);
			fm.newProp = "Hello new property!"
		})

	}

	static async getCanvasData(file: TFile | null): Promise<{nodes: Array<CanvasNodeData>, edges: Array<CanvasEdgeData>} | undefined> {
		if (file === null || file.extension !== 'canvas') return;
		let rawCanvasText = await file.vault.cachedRead(file);
		let canvas = JSON.parse(rawCanvasText);
		return canvas
	}

	static async getCanvasNodes(file: TFile | null): Promise<CanvasNodeMap | undefined> {
		let data = await CanvasPlugin.getCanvasData(file);
		if(data === undefined) return undefined;
		let map: CanvasNodeMap = {
			cards: (<CanvasTextData[]> data.nodes.filter((node)=> node.type == 'text')),
			files: (<CanvasFileData[]> data.nodes.filter((node)=> node.type == 'file')),
			links: (<CanvasLinkData[]> data.nodes.filter((node)=> node.type == 'link')),
			groups: (<CanvasGroupData[]> data.nodes.filter((node)=> node.type == 'group')),
		}
		return map;
	}

	static async getCanvasEdges(file: TFile | null): Promise<CanvasEdgeData[] | undefined> {
		let data = await CanvasPlugin.getCanvasData(file);
		if(data === undefined) return undefined;
		return data.edges
	}

	static async getCanvasMap(file: TFile | null): Promise<CanvasMap | undefined>{
		if(!file) return undefined;

		let map: CanvasMap | undefined;
		let edges: CanvasEdgeData[] | undefined;

		await Promise.all([
			map = await CanvasPlugin.getCanvasNodes(file),
			edges = await CanvasPlugin.getCanvasEdges(file),
		])
		
		map!.edges = edges;

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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Your vault is: ' + app.vault.getName());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: CanvasPlugin;

	constructor(app: App, plugin: CanvasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}

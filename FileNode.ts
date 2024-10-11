import { CanvasFileData, CanvasGroupData } from "canvas";
import { CanvasMap, SemanticCanvasPluginSettings, ConnectionProps } from "main";
import { App, TFile } from "obsidian";

/**
 * Represents an instance of a node on the canvas that represents a file in the vault
 */
export class FileNode {
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
			if (relevantIds.some(id => edge.fromNode == id)) return true;
			/* In case link is bi-directional */
			if (relevantIds.some(id => edge.toNode == id && edge.isBidirectional)) return true;
			return false;
		});

		if (relevantEdges?.length === 0 && file.inGroups.length === 0) {
			this.propsOnCanvas = null;
			return;
		}

		let edges: ConnectionProps[] = (relevantEdges?.map(edge => {
			let newEdge: ConnectionProps = {
				otherSideId: edge.toNode,
				isBidirectional: edge.isBidirectional
			};
			if (file.id === newEdge.otherSideId) newEdge.otherSideId = edge.fromNode;
			newEdge.otherSide = data.cards?.find(card => card.id === newEdge.otherSideId);
			newEdge.type = 'card';
			newEdge.propLbl = settings.cardDefault;
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.urls?.find(url => url.id === newEdge.otherSideId);
				newEdge.type = 'url';
				newEdge.propLbl = settings.urlDefault;
			}
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.files?.find(file => file.id === newEdge.otherSideId);
				newEdge.type = 'file';
				newEdge.propLbl = settings.fileDefault;
			}
			if (newEdge.otherSide === undefined) {
				newEdge.otherSide = data.groups?.find(group => group.id === newEdge.otherSideId);
				//#TODO - can you prevent "in group" memberships here when there's an arrow to the group with the same label as the group?
				newEdge.type = 'group';
			}
			if (newEdge.otherSide === undefined) throw new Error('Could not find other side of edge');
			if (newEdge.type === 'card') newEdge.propVal = newEdge.otherSide.text;
			if (newEdge.type === 'url') newEdge.propVal = newEdge.otherSide.url;
			if (newEdge.type === 'file') newEdge.propVal = convertToWikilink(newEdge.otherSide as CanvasFileData, this);
			if (edge.label !== undefined) newEdge.propLbl = edge.label;
			return newEdge;
		}).filter(newEdge => newEdge.propLbl !== undefined && newEdge.propLbl !== ''))!;

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
					return;
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			});
		}

		/* this -> url */
		if (settings.useUrls) {
			edges.filter(edge => edge.type === 'url').forEach(edge => {
				if (!this.propsOnCanvas.hasOwnProperty(edge.propLbl)) {
					this.propsOnCanvas[edge.propLbl!] = [edge.propVal];
					return;
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			});
		}
		/* this -> note */
		if (settings.useFiles) {
			edges.filter(edge => edge.type === 'file').forEach(edge => {
				if (!this.propsOnCanvas.hasOwnProperty(edge.propLbl)) {
					this.propsOnCanvas[edge.propLbl!] = [edge.propVal];
					return;
				}
				this.propsOnCanvas[edge.propLbl!].push(edge.propVal);
			});
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

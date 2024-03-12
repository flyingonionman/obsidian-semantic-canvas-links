# Obsidian Semantic Canvas Plugin

This is a plugin for [Obsidian](https://obsidian.md) gives canvases the power to edit file properties *visually*.

Set properties for all Markdown files included in your canvas based on their group membership, links to files, links to cards, and links to web embeds. Create new properties or edit existing ones on multiple markdown notes at once through the canvas. Create **semantic links** *(aka typed links or labeled links)* between notes and work with them using an intuitive graph-based approach.

## Example Screenshots

One command to turn this:
![Before image](assets/before.png)

Into this:
![After image](assets/after.png)

## Use Cases

- Building & representing knowledge graphs
- Mass editing properties
- Venn Diagrams & Kanbans

## Usage

After installation, open a canvas then use command palette to run either:
- `Semantic Canvas: Append Note Properties based on Canvas` 
- `Semantic Canvas: Overwrite Note Properties based on Canvas`

### Behaviors
> 📖 Node Types  
> Nodes on a canvas are typed as one of `card`, `url`, `file`, or `group`. 

Semantic Canvas modifies properties of **Markdown files** based on how they're connected to nodes (i.e. `files`, `groups`, `cards`, `urls`) in the active Canvas.

![Behaviors image](assets/behaviors.png)

- Each Node Type behavior can be toggled off.
- If an edge is labeled, the property set on the `file` will use that label as the property key.
- If an edge is unlabeled, the property set on the `file` will use the default label for that node type.
- If a group contains notes, those `files` will have their `groups` (by default) property set to the value of the title(s) of the group(s) the note is contained in.
- If a note is connected to a `group`, it behaves as though the note is connected to every node contained in the group

# Dev Notes

Working next on the *other* direction - using a note to create a canvas based on its metadata.
# Hank — Future Ideas

## Visual Pipeline Editor in Dashboard

On startup, immediately open the browser and show a configurable flow diagram of how work items move through stages/agents. Features:

- **Interactive graph**: Stages as nodes, transitions as directional arrows between them
- **Drag-and-drop arrows**: Reorder or reroute transitions by dragging arrow endpoints from one stage to another
- **Delete/add agents**: Remove agents from pools or add new ones directly from the UI
- **Live config editing**: All interactions directly edit `pipeline.yml` and `hank.yml` on disk — the UI is just a visual editor for the declarative config
- **Auto-open**: `hank start` or `hank dashboard` opens the browser window automatically

This would make the pipeline fully visual — users configure everything by drawing the graph, and the YAML files are just the serialized form.

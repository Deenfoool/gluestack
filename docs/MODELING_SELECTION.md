# Modeling selection

Object and Edit modes share the **Select** menu and shortcuts:

| Action | Shortcut | Behavior |
| --- | --- | --- |
| All | A | Visible objects, or all components in the current Edit selection mode |
| None | Alt+A | Clear selection |
| Invert | Ctrl/Cmd+I | Complement within the same selection universe |
| Linked | L | Edit only: expand seeded connected mesh islands |
| Edge Loop | Ctrl/Cmd+Alt+L | Edge mode: extend through regular quad vertices or along an unambiguous boundary |
| Edge Ring | Ctrl/Cmd+Alt+R | Edge mode: cross opposite edges of adjacent quads |
| By Material | Shift+M | Face mode: select all faces matching any selected face's material slot |
| Box | B | Drag LMB to replace, Shift to add, Ctrl/Cmd to subtract; Escape cancels |
| Circle | C | LMB paints add, Ctrl/Cmd+LMB paints subtract; wheel changes radius; Enter/Escape finishes |

Object selection includes visible meshes, lines, points, lights and cameras. A hidden parent excludes its entire subtree. Collections remain containers, selectable explicitly in the Outliner. Box uses projected object bounds; Circle uses object bounds centers. Cameras/lights with no geometry use their world origins.

Edit selection uses logical polygon edges; internal triangulation diagonals cannot be selected by All, Invert, Linked, Box or Circle. Box tests actual projected segment intersection; Circle tests distance to the entire segment. Faces use the average projected position of their unique vertices. Box/Circle currently select through geometry (no occlusion test); vertices outside the camera depth range are skipped. Edges crossing the near plane are skipped if either endpoint is outside the depth range. Polygon clipping and a visibility/X-ray toggle remain follow-up work.

Each selection pass updates the mesh world matrix once and projects each vertex once. Linked uses a cursor-based graph traversal. Box/Circle suspend orbit and gizmo input, restore their previous states, exclude each other, and end on pointer cancellation, blur, hidden document or Home opening. Circle strokes outside the viewport do not change selection. Unrelated pointers cannot move or release the active stroke.

## Quad topology selection

Loop and Ring commands expand every selected seed and retain those seeds. Interior loops continue only through valence-four vertices with a connected manifold quad fan. Boundary loops follow the two boundary edges of a connected quad fan, including corners. The traversal stops at poles, triangles/n-gons, non-manifold edges and disconnected surface fans; it never guesses a branch or selects a triangulation diagonal. Rings cross the opposite edge of each simple quad and stop at non-quad faces or non-manifold junctions. Cycles use visited sets and iterative queues, so closed loops terminate.

The editor currently groups connected coplanar triangles of the same material into a logical polygon. A flat subdivided plane may therefore be a single n-gon, and torus bands at equal height may be merged. Loop/Ring operate on those logical polygons. Preserving explicit authored quad partitions is future topology work; this batch does not change the grouping model.

Select by Material uses material **slot indices on the edited mesh**, taking the union of all seed faces' slots. Separate GLTF material primitives remain separate meshes after import; selection does not cross into other objects. No geometry or history is changed by these selection commands.

## Validation

`npm test` includes 23 Modeling selection regressions using real Three.js cameras/objects, the Edit controller selection methods, JSDOM pointer dispatch, and the installed keyboard/menu handlers. Coverage includes logical edges, disconnected islands, hidden ancestors, light selection, additive/subtractive selection, segment hit accuracy, vertex/edge/face modes, cancellation, Home, and form focus. Topology coverage includes real warped quad grids and a torus, open boundaries, multiple seeds, cube poles, merged n-gons, non-manifold edges, disconnected fans, stale/diagonal seeds, material-slot unions, actual multi-material GLB export/import and the Loop/Ring/Material menu/shortcut handlers.

Automated Node checks pass. Browser/WebGL QA on primitive and imported models is still required; the available browser has WebGL disabled. This document does not close the roadmap release gates.

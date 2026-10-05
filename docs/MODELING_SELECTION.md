# Modeling selection

Object and Edit modes share the **Select** menu and shortcuts:

| Action | Shortcut | Behavior |
| --- | --- | --- |
| All | A | Visible objects, or all components in the current Edit selection mode |
| None | Alt+A | Clear selection |
| Invert | Ctrl/Cmd+I | Complement within the same selection universe |
| Linked | L | Edit only: expand seeded connected mesh islands |
| Box | B | Drag LMB to replace, Shift to add, Ctrl/Cmd to subtract; Escape cancels |
| Circle | C | LMB paints add, Ctrl/Cmd+LMB paints subtract; wheel changes radius; Enter/Escape finishes |

Object selection includes visible meshes, lines, points, lights and cameras. A hidden parent excludes its entire subtree. Collections remain containers, selectable explicitly in the Outliner. Box uses projected object bounds; Circle uses object bounds centers. Cameras/lights with no geometry use their world origins.

Edit selection uses logical polygon edges; internal triangulation diagonals cannot be selected by All, Invert, Linked, Box or Circle. Box tests actual projected segment intersection; Circle tests distance to the entire segment. Faces use the average projected position of their unique vertices. Box/Circle currently select through geometry (no occlusion test); vertices outside the camera depth range are skipped. Edges crossing the near plane are skipped if either endpoint is outside the depth range. Polygon clipping and a visibility/X-ray toggle remain follow-up work.

Each selection pass updates the mesh world matrix once and projects each vertex once. Linked uses a cursor-based graph traversal. Box/Circle suspend orbit and gizmo input, restore their previous states, exclude each other, and end on pointer cancellation, blur, hidden document or Home opening. Circle strokes outside the viewport do not change selection. Unrelated pointers cannot move or release the active stroke.

## Validation

`npm test` includes 11 Modeling selection regressions using real Three.js cameras/objects, the Edit controller selection methods, JSDOM pointer dispatch, and the installed keyboard/menu handlers. Coverage includes logical edges, disconnected islands, hidden ancestors, light selection, additive/subtractive selection, segment hit accuracy, vertex/edge/face modes, cancellation, Home, and form focus.

Automated Node checks pass. Browser/WebGL QA on primitive and imported models is still required; the available browser has WebGL disabled. This document does not close the roadmap release gates.

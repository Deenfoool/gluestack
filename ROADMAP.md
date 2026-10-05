# Roadmap gluestack

`gluestack` — браузерный Blender-подобный 3D-редактор для создания, редактирования, UV-развёртки, текстурирования, анимации, оптимизации и экспорта игровых `.glb` без обязательного backend.

Этот roadmap — рабочий план до стабильного `v1.0`. Галочка означает, что функция **реализована по коду**; release-gates отдельно требуют реального browser/regression QA.

## Правила проекта

- Один актуальный pipeline на одну задачу. Заменённый код, мёртвые ветки и устаревшие файлы удаляются в том же изменении.
- Git history используется вместо хранения legacy-кода рядом с новой реализацией.
- Нельзя молча терять данные GLB. Неподдерживаемая destructive-операция обязана отказаться до изменения данных.
- Runtime `.glb` не должен содержать editor-only `gluestack*` / `__gluestack*` metadata.
- Editor-state хранится в `.gluestack` и имеет централизованный version/migration layer.
- Optional feature не должен валить Object/Edit Mode при ошибке загрузки.
- Изменяющая проект операция обязана иметь Undo/Redo/checkpoint.
- Долгие операции не должны блокировать UI без progress/cancel после появления worker pipeline.

## Definition of Done

Функция считается готовой к релизу, когда она:

1. работает минимум на primitive и импортированной модели;
2. не создаёт NaN, empty geometry, broken groups/indices или dangling resources;
3. сохраняет заявленные UV/material/animation/custom data либо заранее блокируется;
4. корректно освобождает geometry/material/texture resources;
5. участвует в Undo/Redo;
6. переживает `.gluestack save → open`, если это editor-state;
7. переживает `.glb export → import`, если это runtime-state;
8. проходит соответствующий golden/regression fixture;
9. не добавляет необъяснённый `FAIL` в Diagnostics;
10. показывает понятную ошибку пользователю, а не только console exception.

---

# Реализованный baseline

## Этап 0 — фундамент

- [x] GitHub Pages static app.
- [x] Blender-подобные menu / toolbar / viewport / Outliner / Properties.
- [x] Three.js viewport, camera, grid, lighting.
- [x] Lucide icons.
- [x] PWA manifest и favicon/app icons из `assets/images/`.
- [x] Base primitives: Cube / Sphere / Cylinder / Cone / Plane / Torus.
- [x] `.glb/.gltf` import и `.glb` export.
- [x] Multi-file `.gltf + .bin + textures` local resolver.
- [x] Failure isolation feature-модулей.

## Этап 1 — Object Mode

- [x] Undo / Redo.
- [x] Collections / parenting / Outliner hierarchy.
- [x] Multi-select.
- [x] Duplicate / Join / Separate / Apply Transform / Origin.
- [x] `G X 2`, `R Z 90`, `S 2` numeric transform.
- [x] Grid snap.
- [x] Scene/Camera state в history.

## Этап 2 — Edit Mode

- [x] Object/Edit через `Tab`.
- [x] Vertex / Edge / Face select.
- [x] Component transform + gizmo.
- [x] Indexed/non-indexed topology layer.
- [x] Extrude / Inset / Merge / Fill / Delete.
- [x] Recalculate / Flip Normals.
- [x] Bevel / Dissolve / Loop Cut / Knife.
- [x] UV и поддерживаемые BufferAttributes сохраняются/интерполируются при topology edit.
- [x] Guards для Skin / Morph / Instanced сценариев без safe pipeline.

## Этап 3 — Modifiers

- [x] Mirror / Array / Bevel / Solidify / Subdivision / Decimate / Triangulate.
- [x] Boolean Union / Difference / Intersect для поддерживаемых watertight mesh.
- [x] Non-destructive Modifier Stack.
- [x] Enable/Disable / remove / Up/Down.
- [x] Editable parameters после добавления modifier.
- [x] Duplicate modifier.
- [x] Drag reorder.
- [x] Collapse/expand cards с сохранением UI-state в `.gluestack`.
- [x] Explicit per-modifier error state.
- [x] `Bake Through Here` — безопасно запекает stack-prefix в source geometry.
- [x] Apply Stack / Clear Stack.
- [x] `.gluestack` сохраняет source geometry + descriptors; runtime GLB получает evaluated geometry.
- [x] Multi-material-aware simplification сохраняет groups/materialIndex.

## Этап 4 — UV Editing

- [x] Отдельный UV workspace без второго WebGL renderer.
- [x] UV Vertex / Edge / Island selection.
- [x] Mark/Clear Seam.
- [x] Cube / Cylinder / Sphere / View projections.
- [x] Move / Rotate / Scale / drag.
- [x] Smart seams по face-angle threshold.
- [x] Harmonic/cotangent unwrap solver для seam-islands.
- [x] Relax для внутренних UV vertices.
- [x] Stretch heatmap / distortion score.
- [x] Aspect-aware Pack Islands вместо фиксированной grid.
- [x] Optional island rotation 90°.
- [x] Pixel padding при заданном texture resolution.
- [x] Preserve island aspect ratio.
- [x] Pack Selected.
- [x] Uniform Normalize 0..1 с сохранением относительного scale/density.
- [x] Texel Density measure / set / match selected.
- [x] Overlap / out-of-bounds / zero-area UV checks.
- [x] UV Mirror X/Y.
- [x] Island Align Left/Right/Top/Bottom/Center.
- [x] Stitch/Weld selected duplicate UV edges + seam removal.
- [x] Reference/Base Color texture под UV.

## Этап 5 — Materials / Texture Paint

- [x] glTF-compatible PBR на `MeshStandardMaterial`.
- [x] Base Color / Normal / Roughness / Metallic / AO / Emissive / Opacity.
- [x] PNG / JPEG / WebP textures.
- [x] Material Preview.
- [x] Texture offset / scale / rotation.
- [x] Multi-material slot editing.
- [x] Shared texture lifecycle protection.
- [x] Texture Paint по material slot.
- [x] Paint Base Color / Roughness / Metallic / Normal / Emissive.
- [x] sRGB/linear channel handling.

## Этап 6 — Projects / Recovery

- [x] IndexedDB named projects.
- [x] Dirty-state indicator.
- [x] `Ctrl+S` local quick-save / `Ctrl+Shift+S` project download.
- [x] `beforeunload` warning для dirty project.
- [x] Debounced generation-safe autosave.
- [x] Backup предыдущего autosave snapshot.
- [x] Recover current / previous autosave.
- [x] Transaction-like project open: decode/parse/validate до замены live-scene.
- [x] Corrupted project/header/GLB rejection.
- [x] `.gluestack` v2 container.
- [x] Централизованный `src/projects/format.js` и migration `v1 → v2`.
- [x] Newer unsupported version блокируется с объяснением.
- [x] Формальная спецификация `docs/PROJECT_FORMAT.md`.
- [x] Project integrity summary: mesh/material/texture/animation/modifier stack/userData counts.
- [x] Central runtime/editor/transient `userData` policy.
- [x] Project payload strips transient `__gluestack*`, сохраняя editor-state и imported extras.
- [x] Safe history clone Skinned hierarchy / CanvasTexture.

## Этап 7 — Game Ready baseline

- [x] Mesh / vertex / triangle / material / texture stats.
- [x] Texture RAM estimate.
- [x] Missing normals / non-unit scale / empty mesh / NaN / oversized texture checks.
- [x] Optimize Scene: merge compatible vertices + material dedup.
- [x] LOD0/LOD1/LOD2 generation.
- [x] UV-safe multi-material LOD/Decimate для поддерживаемых attributes.
- [x] Real GLB byte-size estimate.
- [x] Production topology validation: degenerate / non-manifold / open edges.
- [x] Inconsistent winding / negative mirrored transform warnings.
- [x] Invalid/unused material group/slot validation.
- [x] Normal-map prerequisites / tangent-policy warning.
- [x] Optimize `before → after` report.
- [x] Dry-run Cleanup Preview.
- [x] Pixel-content duplicate texture audit.
- [x] Web / Generic glTF / Godot / Unity export profile wiring.
- [x] ORM packing with UV-channel/transform compatibility guards.
- [x] Texture resize policy + memory preview.
- [x] Compatible normal-map tangent generation.

## Этап 8 — Animation / Scene / Generators

- [x] Rock / Island / Tree / Crate generators.
- [x] Scene/Camera controls + exported Light/Camera.
- [x] Animation clip import/export/project/history round-trip.
- [x] Preview Play / Stop / Speed.
- [x] Rename retargets tracks.
- [x] Transform Keyframe Editor.
- [x] Dope Sheet: scrub / key drag-time / delete.
- [x] Linear / Step / Smooth interpolation capability check.

---

# P0 — путь к v1.0

P0 имеет приоритет над новыми экспериментальными фичами.

## P0.1 Browser QA

- [ ] Полный Pages flow: `New → Modeling → Edit → UV → Material → Paint → Modifiers → Save → Reload → Export → Re-import`.
- [ ] Все workspaces/menu/actions без runtime exceptions.
- [ ] Hotkeys и focus conflicts.
- [ ] Chrome desktop.
- [ ] Edge desktop.
- [ ] Firefox desktop.
- [ ] Resize / fullscreen / high-DPI / browser zoom.
- [ ] WebGL context lost/restored без потери проекта.
- [ ] 10+ project opens в одной сессии без stale selection/gizmo/GPU leaks.

## P0.2 Golden regression fixtures

Fixture-набор создан в `tests/fixtures/`; реальный PASS остаётся release-gate.

- [x] primitive single-material fixture.
- [x] multi-material + groups fixture.
- [x] UV fixture.
- [x] PBR texture channels fixture.
- [x] real external `.gltf + .bin + texture` fixture.
- [x] transform animation fixture.
- [x] SkinnedMesh fixture.
- [x] morph target fixture.
- [x] custom BufferAttribute fixture.
- [x] high-poly fixture.
- [x] malformed GLTF negative fixture.
- [x] real binary `.gluestack v1` migration fixture.
- [x] Help → `Run Golden Fixtures` regression runner.
- [x] External fixture использует тот же `importer.parseFiles()` resolver, что пользовательский import.
- [x] Golden runner проверяет `.gluestack v1 → v2` decode/migration/GLB parse.
- [ ] Реально прогнать все fixtures на GitHub Pages и зафиксировать PASS/known WARN.
- [ ] Для fixtures прогнать `.gluestack save → open` editor-state round-trip.
- [ ] Проверить destructive guards на unsupported fixtures.

## P0.3 Project/data-loss hardening

- [x] Dirty state.
- [x] Save / Save As shortcuts.
- [x] Close-tab protection.
- [x] Autosave generation IDs.
- [x] Previous autosave backup.
- [x] Corrupted project detection.
- [x] Transaction-like open.
- [x] Current/previous project version policy.
- [x] Clean runtime GLB clone strips `gluestack*` / `__gluestack*` keys.
- [x] Project export strips transient `__gluestack*` without removing editor-state/imported extras.
- [x] Central Metadata Policy classifies runtime / editor / transient keys.
- [x] Help → Metadata Audit compares live / project / clean-export metadata.
- [x] Diagnostics проверяет clean-export metadata leak.
- [x] Diagnostics проверяет corrupted/newer project rejection.
- [x] Migration fixture для настоящего `.gluestack v1`.
- [ ] Реально прогнать Metadata Audit на production Pages без `FAIL`.

## P0.4 Modifier Stack production

- [x] Edit existing modifier params.
- [x] Duplicate modifier.
- [x] Drag reorder.
- [x] Collapse/expand + persisted UI state.
- [x] Explicit failed-modifier state.
- [x] `Bake Through Here` для корректной mid-stack семантики.
- [x] Intermediate cache/invalidation для тяжёлых stacks: неизменённый prefix переиспользуется, замена source инвалидирует кеш; автоматическая регрессия.
- [x] Documented destructive Boolean policy v1 — [семантика и ограничения](./docs/MODIFIER_STACK.md).
- [x] Stack-safe Duplicate object: независимые source/descriptors, Undo/Redo regression.
- [x] Stack-safe Apply Transform / Origin: мировая геометрия сохраняется; вся выборка проверяется до изменения; regression для failed stack / unsupported meshes.
- [x] Source-cache lifecycle regression после delete/open/bake/apply/clear и удаления последнего modifier; 12 бинарных `.gluestack` reopen в Node.

Проверки запускаются через `npm ci && npm test`. P0.4 проверен на уровне DOM/геометрии; production browser/WebGL QA в P0.1/P0.2 остаётся незавершённым.

## P0.5 Advanced UV release QA

Функциональный код реализован; release-ready статус зависит от реального regression PASS.

- [x] Angle-based smart island segmentation.
- [x] Non-planar harmonic/cotangent unwrap.
- [x] Relax.
- [x] Stretch heatmap.
- [x] Bounding-box packer.
- [x] 90° rotate during packing.
- [x] Pixel padding / resolution.
- [x] Aspect preservation.
- [x] Pack Selected.
- [x] Normalize 0..1.
- [x] Texel density measure/set/match.
- [x] Overlap/OOB/degenerate checks.
- [x] Mirror/Align.
- [x] Stitch/Weld.
- [x] UV Golden runner: cube hard seams / cylinder / sphere / irregular organic / hole topology.
- [x] UV Golden runner проверяет Relax signed-area inversion.
- [x] UV Golden runner stress-тестирует packer на 100 islands.
- [ ] Реально прогнать UV Golden Fixtures на GitHub Pages без unexplained FAIL.
- [ ] Worker/cancel для тяжёлого unwrap/pack — переносится в Performance P1, если P0 fixtures укладываются в интерактивное время.

## P0.6 Game Ready optimizer v2

- [x] Export profiles: Web / Godot / Unity / Generic glTF связаны с clean GLB export.
- [x] Profiles не меняют scale/up-axis молча; различия ограничены безопасными export-настройками.
- [x] Safe ORM channel packing с одинаковым UV channel/transform/wrap policy.
- [x] Texture resize 512/1K/2K/4K + memory preview.
- [x] Alpha/transparency protection: RGBA сохраняется при resize, alphaMap/base alpha не удаляются optimizer-ом.
- [x] Tangent generation/recalculation для compatible normal-mapped mesh.
- [x] Negative scale / winding validation.
- [x] Duplicate position-vertex warning.
- [x] Non-manifold/open/degenerate validation.
- [x] Material slot/group validation.
- [x] Duplicate texture-content detection через pixel SHA-256 audit.
- [x] Cleanup preview до Apply без изменения сцены.
- [x] `before → after` optimization report.
- [x] Optimize остаётся одной Undo operation.
- [ ] Реально прогнать Cleanup Preview / Resize / ORM / Tangents на golden textured assets.

## P0.7 LOD policy

- [x] User-editable ratios.
- [x] Triangle floor для source и сгенерированных LOD levels.
- [x] Per-object skip flag.
- [x] Preserve / Recalculate normals policy.
- [x] Hard-edge signature sanity warning.
- [x] Simplification sanity metrics: triangles / bounds / UV validity / hard-edge signature.
- [x] Screen coverage/distance runtime metadata.
- [x] Export all LODs / LOD0 only / individual LOD files.
- [x] Существующая LOD-chain не заменяется без явного Replace.
- [ ] Реально прогнать LOD policy на textured/multi-material/hard-edge golden assets.

---

# P1 — Modeling UX

## Selection / topology

- [x] Box Select.
- [x] Circle Select.
- [x] Select All / Invert / None в Object/Edit.
- [x] Select Linked.

> Selection batches: общий Select menu, logical-edge/hidden-object fixes, quad Loop/Ring, material-slot union и временный Hide/Reveal компонентов; 37 Node selection/visibility regressions PASS. Семантика и ограничения: [docs/MODELING_SELECTION.md](docs/MODELING_SELECTION.md). Browser/WebGL release QA остаётся открытым.

- [x] Edge Loop Select.
- [x] Edge Ring Select.
- [x] Select by Material.
- [x] Hide / Unhide Edit components.
- [ ] Edge Slide / Vertex Slide.
- [ ] Duplicate geometry внутри Edit Mode.
- [ ] Separate by Selection / Material / Loose Parts.
- [ ] Bridge Edge Loops.
- [ ] Spin/Revolve.
- [ ] Face Orientation overlay.
- [ ] Auto Smooth / sharp-edge workflow.
- [ ] Proportional Editing.
- [ ] Vertex / Edge / Face snapping.
- [ ] Transform orientation Global / Local / Normal.
- [ ] Pivot Median / Individual / Cursor.

## Blender-like navigation

- [ ] N-sidebar.
- [ ] `T` toolbar toggle.
- [ ] 3D Cursor.
- [ ] `Shift+S` snap menu.
- [ ] `F3` command search.
- [ ] Numpad emulation.
- [ ] User-editable hotkeys.

---

# P1 — Materials / Paint

- [ ] Material slot add/remove/reorder.
- [ ] Assign selected faces to material slot.
- [ ] Material duplicate/unlink.
- [ ] Texture wrap/filter/aniso.
- [ ] Normal scale.
- [ ] Alpha Opaque / Mask / Blend + cutoff.
- [ ] Double-sided control.
- [ ] glTF extension policy before Clearcoat/Transmission/IOR UI.
- [ ] Material export validation.
- [ ] One paint stroke = one Undo entry.
- [ ] Brush hardness/falloff.
- [ ] Eraser.
- [ ] Color picker from model/texture.
- [ ] Fill by island/material.
- [ ] Seam-aware paint padding.
- [ ] Texture resolution create/resize.
- [ ] Export painted texture separately.

---

# P1 — Animation

- [ ] Graph Editor workspace.
- [ ] Position/Rotation/Scale F-curves.
- [ ] Tangent/handle editing.
- [ ] Frame timeline + FPS.
- [ ] Start/End range.
- [ ] Loop playback.
- [ ] Duplicate / Copy / Paste keyframes.
- [ ] Box Select keys.
- [ ] Snap keys to frame/playhead.
- [ ] Scale group of keys around time pivot.
- [ ] Track mute/solo.
- [ ] Clip rename/duplicate.
- [ ] Missing-target / duplicate-name / invalid-time validation.
- [ ] Bone animation editing только после отдельного rig-safe design.

---

# P1 — Performance / большие сцены

- [ ] Startup/load/edit/export profiling на low/mid/high-poly fixtures.
- [ ] Web Workers: simplify / UV solve-pack / optimization.
- [ ] Progress + cancel для long tasks.
- [ ] Non-blocking large GLB encode/decode.
- [ ] Adaptive pixel ratio.
- [ ] Throttled helpers/Outliner refresh.
- [ ] Memory diagnostics panel.
- [ ] Oversized CanvasTexture detection.
- [ ] Hot-path audit на O(n²) scans.

---

# P1 — Import / Export compatibility

- [x] Multiple glTF scenes policy: default scene + явное предупреждение, Node Diagnostics regression.
- [x] Camera/punctual light golden test: projection/intensity/range, Node Diagnostics PASS.
- [x] SkinnedMesh GLB round-trip с bone animation; Node regression.
- [x] Morph GLB round-trip с weights animation; Node regression.
- [x] Tangent / vertex color / UV1 fixtures: Node Diagnostics PASS.
- [x] Data URI resources: Node Diagnostics PASS.
- [x] Sidecar duplicate-filename conflict resolver: относительные пути до basename, отказ при неоднозначности, изоляция параллельных импортов.
- [x] Unsupported extensions: отказ для неизвестных required, предупреждение для optional; [политика v1](./docs/IMPORT_EXPORT.md).
- [ ] Draco policy.
- [ ] KTX2/Basis strategy.
- [ ] Meshopt strategy.
- [ ] Export Selected.
- [ ] Safe scale/up-axis presets.

---

# P1 — Project UX / UI / PWA

- [ ] Project browser вместо prompts.
- [ ] Rename / duplicate / delete local project.
- [ ] Last opened projects.
- [ ] Autosave timestamp/recovery preview.
- [ ] Manual snapshots/checkpoints.
- [ ] Project size estimate.
- [ ] Local cache cleanup UI.
- [ ] Drag/drop `.gluestack`, GLB/GLTF/textures.
- [ ] Resizable panels + persisted layout.
- [ ] Focus/shortcut audit.
- [ ] Tooltips + ARIA + keyboard-only pass.
- [ ] Contrast/focus-visible audit.
- [ ] Touch/tablet navigation policy.
- [ ] PWA installability audit.
- [ ] Offline/service worker только после cache invalidation design.
- [ ] OpenGraph/portfolio metadata.
- [ ] Loading/progress screen для heavy modules/models.

---

# P2 — после стабильного v1.0

- [ ] Curves / paths.
- [ ] Text → mesh.
- [ ] Lattice/deform tools.
- [ ] Geometry Nodes-подобный procedural graph — отдельный этап.
- [ ] Sculpting — отдельный продуктовый этап.
- [ ] Procedural Cliff / Bush / Fence / Pier / Road / Stairs / Arch / Pipe / Roof / Door / Window / Wheel / Gear / Terrain.
- [ ] Parametric presets + random seed.
- [ ] Multiple UV-set editing.
- [ ] Lightmap UV generation.
- [ ] UDIM только при реальном use-case.
- [ ] Animation constraints / drivers / NLA-like sequencing.
- [ ] Rig/bone editor — отдельная архитектура.

---

# Release gates v1.0

`v1.0` готов только когда одновременно выполнены:

- [ ] P0 browser QA закрыт в Chrome/Edge/Firefox desktop.
- [ ] Golden fixtures не имеют необъяснённых `FAIL`.
- [ ] Нет известного silent data-loss для поддерживаемой операции.
- [ ] `.gluestack v1 → v2` migration/recovery реально протестированы на production Pages.
- [ ] Import → edit → save → reopen → export → reimport пройден на golden fixtures.
- [ ] Repeat project load не оставляет stale selection/gizmo/resources.
- [ ] Advanced UV regression fixtures реально пройдены.
- [ ] Game Ready report соответствует реально экспортированному GLB.
- [ ] README содержит только актуальное описание, Pages link, возможности/ограничения, licenses, roadmap.
- [ ] `THIRD_PARTY_LICENSES.md` соответствует runtime dependencies.
- [ ] Нет duplicate/obsolete prototype files/assets/code paths.
- [ ] Portfolio/favicon/PWA metadata соответствуют текущему продукту.

## Текущий порядок работ

1. **P0 browser/golden QA — реальный запуск остаётся главным release gate.**
2. **Modifier Stack: production browser QA для кеша и безопасных операций (Node regression выполнен).**
3. **Import/export compatibility hardening.**
4. **Performance/workers.**
5. **P1 Modeling UX + Materials/Paint.**
6. **Graph Editor.**
7. **Release audit → v1.0.**

Если новая задача не исправляет реальный defect и не относится к P0/P1, она не должна вытеснять release blockers.

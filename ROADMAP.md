# Roadmap gluestack

`gluestack` — браузерный Blender-подобный 3D-редактор для создания, редактирования, UV-развёртки, текстурирования, оптимизации и экспорта игровых `.glb` без обязательного backend.

Этот roadmap — не список кнопок. Пункт считается завершённым только тогда, когда операция работает на реальной сцене, не теряет поддерживаемые данные, корректно участвует в Undo/Redo и проходит round-trip сохранения/экспорта там, где это применимо.

## Правила проекта

- Один актуальный pipeline на одну задачу. Заменённый код, мёртвые ветки и устаревшие файлы удаляются в том же изменении.
- История Git используется вместо хранения legacy-кода рядом с новой реализацией.
- Нельзя молча терять данные GLB. Если операция пока не умеет безопасно сохранить feature/attribute, она должна отказаться от выполнения и объяснить причину.
- Обычный экспорт `.glb` содержит только runtime/game-ready данные. Editor-only состояние хранится только в `.gluestack`.
- Optional feature не должен валить базовый Object/Edit Mode при ошибке загрузки.
- Все destructive-операции обязаны иметь Undo/Redo или явный безопасный checkpoint.
- Любая новая editor-only структура должна иметь стратегию versioning/migration для `.gluestack`.

## Definition of Done для функции

Функция считается готовой, если:

1. работает не только на Cube, но и минимум на импортированной модели;
2. не создаёт `NaN`, пустую geometry, broken indices/groups или dangling references;
3. сохраняет заявленные UV/material/custom attributes либо заранее блокируется;
4. корректно освобождает geometry/material/texture resources;
5. участвует в Undo/Redo, если меняет проект;
6. переживает `.gluestack save → open`, если это editor-state;
7. переживает `.glb export → import`, если это runtime-state;
8. Diagnostics не сообщает новый `FAIL`;
9. ошибка пользователя показывает понятный status, а не только console exception.

---

# Реализованный baseline

Ниже — уже существующий функциональный слой. Он считается feature-complete по коду, но весь проект всё ещё должен пройти единый release QA.

## Этап 0 — фундамент

- [x] Статическое приложение для GitHub Pages.
- [x] Blender-подобная раскладка: меню, toolbar, viewport, Outliner, Properties.
- [x] Three.js viewport, камера, сетка и освещение.
- [x] Lucide icons.
- [x] PWA manifest и favicon/app icons из `assets/images/`.
- [x] Выбор объектов и Move / Rotate / Scale gizmo.
- [x] Создание Cube / Sphere / Cylinder / Cone / Plane / Torus.
- [x] Импорт `.glb/.gltf` и экспорт `.glb`.
- [x] `.gltf` с внешними `.bin`/текстурами через multi-file import и локальный URL resolver.
- [x] Failure isolation дополнительных feature-модулей.

## Этап 1 — Object Mode

- [x] Undo / Redo с общей историей.
- [x] Collections, parenting и иерархия Outliner.
- [x] Multi-select.
- [x] Duplicate, Join, Separate, Apply Transform, Origin to Geometry.
- [x] Blender-подобный numeric input: `G X 2`, `R Z 90`, `S 2`.
- [x] Базовый snapping.
- [x] Scene/Camera state в Undo/Redo: фон, exposure, камера, orbit target и рабочее освещение.

## Этап 2 — Edit Mode

- [x] Object / Edit через `Tab`.
- [x] Vertex / Edge / Face selection (`1 / 2 / 3`).
- [x] `G / R / S` для компонентов и transform gizmo.
- [x] Indexed/non-indexed mesh через логические welded vertices.
- [x] Extrude, Inset, Merge, Fill, Delete.
- [x] Recalculate / Flip Normals.
- [x] Bevel Face и Dissolve Vertex / Edge.
- [x] Loop Cut по quad-strip.
- [x] Интерактивный Knife для поддерживаемой topology.
- [x] Интерполяция UV и поддерживаемых BufferAttributes при topology-editing.
- [x] Guards для Skinned/Morph/Instanced сценариев, где текущий topology pipeline может потерять данные.

## Этап 3 — Modifiers

- [x] Mirror X/Y/Z.
- [x] Array с Count и XYZ Offset.
- [x] Bevel Modifier.
- [x] Solidify.
- [x] Loop-style Subdivision 1–3.
- [x] Decimate + Triangulate / Normalize.
- [x] Boolean Union / Difference / Intersect для поддерживаемых watertight Mesh.
- [x] Неразрушающий stack для Mirror / Array / Bevel / Solidify / Subdivision / Decimate / Triangulate.
- [x] Enable/Disable, reorder, remove, Apply Stack, Clear Stack.
- [x] `.gluestack` сохраняет source geometry + modifier descriptors.
- [x] Обычный `.glb` экспортирует evaluated geometry без editor-only stack metadata.
- [x] Multi-material-aware simplification сохраняет geometry groups/materialIndex.

## Этап 4 — UV Editing

- [x] Отдельный UV workspace без второго WebGL renderer.
- [x] UV Vertex / Edge / Island selection.
- [x] Mark Seam / Clear Seam.
- [x] Unwrap from seams и Smart UV Project базового уровня.
- [x] Cube / Cylinder / Sphere / View projection.
- [x] UV Move / Rotate / Scale и drag.
- [x] Pack Islands базового уровня.
- [x] Average Island Scale.
- [x] Reference/Base Color texture под UV.

## Этап 5 — материалы и Texture Paint

- [x] `MeshStandardMaterial` / glTF PBR pipeline.
- [x] Base Color / Normal / Roughness / Metallic / AO / Emissive / Opacity.
- [x] PNG / JPEG / WebP texture import.
- [x] Material Preview.
- [x] Texture offset / scale / rotation.
- [x] Multi-material slot editing.
- [x] Shared texture lifecycle protection.
- [x] Texture Paint по выбранному material slot.
- [x] Paint channels: Base Color / Roughness / Metallic / Normal / Emissive.
- [x] Корректное разделение sRGB и linear texture channels.

## Этап 6 — проекты и recovery

- [x] IndexedDB projects.
- [x] Debounced autosave.
- [x] Recover Autosave.
- [x] Бинарный `.gluestack`: GLB payload + editor metadata.
- [x] `.gluestack` v2 для non-destructive modifier stack.
- [x] Camera / selection / snap / viewport/editor state.
- [x] Animation clips внутри project round-trip.
- [x] Safe history clone для Skinned hierarchy и CanvasTexture.
- [x] Editable geometry/material isolation после загрузки проекта.

## Этап 7 — Game Ready

- [x] Mesh / vertex / triangle / material / texture stats.
- [x] Texture RAM estimate.
- [x] Проверки missing normals, non-unit scale, empty mesh, NaN/Infinity, oversized textures.
- [x] Optimize Scene: merge compatible vertices + material dedup.
- [x] LOD0 / LOD1 / LOD2 generation.
- [x] UV-safe и multi-material-aware LOD/Decimate для поддерживаемых attributes.
- [x] Реальный размер экспортируемого GLB через exporter.
- [x] Diagnostics: export→parse и project encode/decode round-trip.

## Этап 8 — animation / scene / generators

- [x] Procedural Rock / Island / Tree / Crate.
- [x] Scene/Camera controls и экспортируемые Light/Camera.
- [x] Animation clip import/export/project/history round-trip.
- [x] Animation preview Play / Stop / Speed.
- [x] Rename retargets animation tracks.
- [x] Transform Keyframe Editor.
- [x] Dope Sheet: key display, scrub, drag/time move, delete key.
- [x] Linear / Step / Smooth interpolation с capability check.

---

# Путь к v1.0

Порядок ниже приоритетный. Пока P0 не закрыт, новые крупные экспериментальные функции не должны отодвигать release blockers.

## P0 — Production Integrity и browser QA

### Полный smoke-test

- [ ] Пройти полный сценарий на опубликованном GitHub Pages: `New → Modeling → Edit → UV → Material → Paint → Modifiers → Save → Reload → Export → Re-import`.
- [ ] Проверить все workspace tabs и все menu/actions на runtime exceptions.
- [ ] Проверить все основные hotkeys и конфликты с input/prompt/UI focus.
- [ ] Проверить Chrome, Edge и Firefox desktop.
- [ ] Проверить resize окна, fullscreen, высокий DPI и browser zoom.
- [ ] Проверить потерю/возврат WebGL context без полной потери проекта.
- [ ] Проверить повторное открытие 10+ проектов за сессию на stale selection, stale gizmos и GPU resource leaks.

### Golden round-trip assets

Добавить небольшой постоянный набор тестовых моделей в отдельную test-fixture область, не в production asset path:

- [ ] primitive single-material;
- [ ] multi-material + groups;
- [ ] UV seams + several islands;
- [ ] BaseColor/Normal/ORM/Emissive textures;
- [ ] external `.gltf + .bin + textures`;
- [ ] animated transform hierarchy;
- [ ] skinned mesh;
- [ ] morph targets;
- [ ] custom BufferAttributes;
- [ ] large/high-poly mesh;
- [ ] intentionally malformed GLTF для negative tests.

Для каждого поддерживаемого fixture:

- [ ] import → export → import сохраняет заявленную структуру;
- [ ] `.gluestack save → open` сохраняет editor state;
- [ ] unsupported операция блокируется до изменения данных;
- [ ] Diagnostics показывает `PASS/WARN`, но не ложный `PASS` при потере данных.

### Crash/data-loss protection

- [ ] Dirty-state indicator: понятно, есть ли несохранённые изменения.
- [ ] `Ctrl+S` / `Ctrl+Shift+S` для project save/save as.
- [ ] Защита от закрытия вкладки при несохранённом проекте.
- [ ] Autosave generation IDs, чтобы старый async autosave не мог перезаписать более новое состояние.
- [ ] Backup предыдущего autosave snapshot, а не только один слот.
- [ ] Corrupted `.gluestack` detection с понятной ошибкой и без удаления текущей сцены.
- [ ] Transaction-like project load: новая сцена заменяет текущую только после успешного decode/parse/validation.

## P0 — Project format hardening

- [ ] Формально описать `.gluestack` header/version в коде и roadmap.
- [ ] Migration layer `v1 → v2 → future`, а не проверки версии в разных местах.
- [ ] Unknown/newer project version открывать read-only или блокировать с объяснением.
- [ ] Не сохранять transient runtime fields в `userData`.
- [ ] Проверять, что game-ready `.glb` не содержит internal gluestack metadata, временных helpers и editor-only nodes.
- [ ] Добавить project integrity summary: meshes/materials/textures/animations/modifier stacks перед сохранением.

## P0 — Modifier Stack до production UX

Stack существует, но для нормального Blender-like workflow нужны следующие пункты:

- [ ] Редактирование параметров уже добавленного modifier без удаления/re-add.
- [ ] Apply одного modifier из середины stack.
- [ ] Duplicate modifier.
- [ ] Drag reorder, а не только Up/Down.
- [ ] Collapse/expand modifier cards.
- [ ] Явный error state у modifier, который не может вычислиться после изменения предыдущего шага.
- [ ] Cache/invalidation: не пересчитывать весь тяжёлый stack без необходимости.
- [ ] Сохранять и восстанавливать UI-state stack в `.gluestack`.
- [ ] Решить non-destructive Boolean как отдельный stack modifier либо оставить destructive и явно закрепить это как ограничение v1.
- [ ] Безопасный workflow `Duplicate / Apply Transform / Origin` для Mesh со stack вместо постоянной блокировки.

## P0 — Advanced UV pipeline

Текущий UV pipeline рабочий, но grid-packing и planar seam-islands недостаточны для сложных game assets.

- [ ] Smart island segmentation по углу между гранями с настраиваемым threshold.
- [ ] Unwrap solver для неплоских seam-islands вместо одной planar projection на island.
- [ ] Relax/minimize stretch после unwrap.
- [ ] Stretch heatmap / distortion overlay.
- [ ] Pack Islands с реальными bounding boxes, а не фиксированной сеткой.
- [ ] Разрешить rotation островов на `90°` при packing.
- [ ] Настраиваемый padding в pixels при выбранном texture resolution.
- [ ] Preserve island aspect ratio.
- [ ] Pack only selected islands.
- [ ] Normalize to 0..1 без изменения относительного texel density.
- [ ] Texel Density: measure / set / match.
- [ ] Detect overlap и out-of-bounds UV.
- [ ] Detect zero-area/degenerate UV triangles.
- [ ] UV mirror X/Y и island align tools.
- [ ] Stitch/Weld UV edges.

## P0 — Game Ready optimizer v2

- [ ] Export profiles: `Web / Godot / Unity / Generic glTF` с минимальными безопасными отличиями.
- [ ] Channel packing: Metallic + Roughness + AO в ORM/packed workflow там, где это безопасно.
- [ ] Texture resize policy: 512/1K/2K/4K с preview итоговой памяти.
- [ ] Потеря alpha/transparency при оптимизации должна блокироваться или явно подтверждаться.
- [ ] Tangent generation/recalculation для normal mapped mesh.
- [ ] Detect mirrored/negative scale и winding issues.
- [ ] Detect duplicate vertices/materials/textures более строго.
- [ ] Detect non-manifold/open edges и degenerate faces.
- [ ] Detect material slots без реально используемых groups.
- [ ] Scene cleanup preview: что именно будет удалено/объединено до Apply.
- [ ] Optimization report `before → after`: triangles, vertices, materials, textures, GLB bytes.
- [ ] Undo всего Optimize operation одной записью.

## P0 — LOD policy

- [ ] LOD ratios редактируемые пользователем.
- [ ] Минимальный triangle floor для маленьких meshes.
- [ ] Skip list для объектов, которые нельзя упрощать.
- [ ] Preserve hard edges / normals policy.
- [ ] Проверка визуальной ошибки simplification хотя бы через bounds/normal/UV sanity metrics.
- [ ] Runtime metadata: screen coverage/distance thresholds для `LOD0/1/2`.
- [ ] Export option: all LODs / only LOD0 / individual LOD files.
- [ ] Не генерировать новый LOD поверх уже существующей LOD-chain без явного replace.

---

# P1 — Modeling UX

## Object/Edit selection

- [ ] Box Select.
- [ ] Circle Select.
- [ ] Select All / Invert / None.
- [ ] Select Linked.
- [ ] Edge Loop Select.
- [ ] Edge Ring Select.
- [ ] Select by material.
- [ ] Hide / Unhide selected components в Edit Mode.

## Modeling tools

- [ ] Edge Slide / Vertex Slide.
- [ ] Duplicate geometry внутри Edit Mode.
- [ ] Separate by Selection / Material / Loose Parts.
- [ ] Bridge Edge Loops.
- [ ] Spin/Revolve базового уровня.
- [ ] Face orientation overlay.
- [ ] Auto Smooth / sharp-edge workflow для game assets.
- [ ] Proportional Editing.
- [ ] Snapping к Vertex / Edge / Face, а не только grid.
- [ ] Transform orientation: Global / Local / Normal.
- [ ] Pivot modes: Median / Individual Origins / Cursor.

## Blender-like navigation

- [ ] N-panel/sidebar вместо части modal prompts.
- [ ] `T` toolbar toggle.
- [ ] 3D Cursor базового уровня.
- [ ] `Shift+S` snap menu.
- [ ] `F3` command search.
- [ ] Numpad emulation для клавиатур без numpad.
- [ ] User-editable hotkey map в project/local settings.

---

# P1 — Materials / Shading / Texture Paint

- [ ] Material slot add/remove/reorder UI.
- [ ] Assign selected faces to material slot в Edit Mode.
- [ ] Duplicate/material unlink workflow.
- [ ] Texture sampler controls: wrap/filter/aniso.
- [ ] Normal scale.
- [ ] Alpha Mode: Opaque / Mask / Blend + cutoff.
- [ ] Double-sided control.
- [ ] Clearcoat/transmission/IOR только после решения glTF extension policy.
- [ ] Material validation против экспортируемых glTF capabilities.
- [ ] Paint Undo batching: один stroke = одна history operation.
- [ ] Brush hardness/falloff.
- [ ] Eraser.
- [ ] Color picker с модели/texture.
- [ ] Fill bucket по UV island/material.
- [ ] Seam-aware painting/padding для mipmap bleed.
- [ ] Texture resolution create/resize UI.
- [ ] Export painted texture отдельно от GLB.

---

# P1 — Animation

Dope Sheet реализован; следующий уровень:

- [ ] Graph Editor workspace.
- [ ] F-curves по Position / Rotation / Scale.
- [ ] Handles/tangents для поддерживаемых interpolation modes.
- [ ] Frame-based timeline с настраиваемым FPS.
- [ ] Start/End playback range.
- [ ] Loop playback.
- [ ] Duplicate keyframes.
- [ ] Copy/Paste keyframes.
- [ ] Box Select keys.
- [ ] Snap keys to frame/playhead.
- [ ] Scale group of keys around pivot time.
- [ ] Per-track mute/solo.
- [ ] Clip rename/duplicate.
- [ ] Animation validation: missing target, duplicate target name, empty track, invalid times.
- [ ] Skeleton/bone animation editing только после отдельного rig-safe design; не смешивать с обычным Object transform editor.

---

# P1 — Performance и большие сцены

- [ ] Профилирование startup/load/edit/export на low/mid/high-poly fixtures.
- [ ] Web Worker для тяжёлых CPU-задач: simplify, UV solve/pack, optimization.
- [ ] Progress + cancel для операций дольше одного кадра.
- [ ] Не блокировать UI при больших GLB encode/decode.
- [ ] Adaptive pixel ratio при тяжёлой сцене.
- [ ] Throttle selection helpers/Outliner refresh на больших сценах.
- [ ] Lazy thumbnails/previews.
- [ ] Memory panel в Diagnostics: geometries/materials/textures/render targets.
- [ ] Detect oversized canvas textures после Texture Paint.
- [ ] Проверить scenes с сотнями объектов без O(n²) selection/resource scans в hot path.

---

# P1 — Import / Export compatibility

- [ ] Multiple glTF scenes: явный выбор или documented policy.
- [ ] Cameras и punctual lights round-trip test.
- [ ] SkinnedMesh round-trip без редактирования skin data.
- [ ] Morph target round-trip без destructive edit.
- [ ] Tangents / vertex colors / UV1+ round-trip tests.
- [ ] Data URI resources в `.gltf`.
- [ ] Duplicate filenames у sidecar textures из разных папок: conflict resolver.
- [ ] Unsupported glTF extensions: список и warning до редактирования/экспорта.
- [ ] Draco import policy.
- [ ] KTX2/Basis texture import/export strategy.
- [ ] Meshopt compression strategy.
- [ ] Экспорт selected objects отдельно от всей сцены.
- [ ] Export scale/up-axis presets только если не меняют модель молча.

---

# P1 — Project UX

- [ ] Project browser вместо `prompt()` для Local Save/Open.
- [ ] Rename / duplicate / delete local project.
- [ ] Last opened projects.
- [ ] Autosave timestamp и recovery preview.
- [ ] Manual snapshot/checkpoint list.
- [ ] Project size estimate.
- [ ] Clear local storage/project cache UI.
- [ ] Import `.gluestack` drag-and-drop.
- [ ] Drag-and-drop GLB/GLTF/textures во viewport.

---

# P1 — UI / accessibility / PWA

- [ ] Resizable Outliner/Properties/UV panels.
- [ ] Persist panel sizes/layout locally.
- [ ] Better focus management: shortcuts не срабатывают при вводе текста/чисел.
- [ ] Tooltips с shortcut и кратким описанием операции.
- [ ] Keyboard-only проход по основным controls.
- [ ] ARIA labels для dynamic feature UI.
- [ ] Contrast/focus-visible audit.
- [ ] Touch/tablet navigation отдельно от desktop mouse bindings.
- [ ] PWA installability audit.
- [ ] Offline shell/service worker только после определения cache invalidation strategy.
- [ ] OpenGraph/meta/portfolio preview для публичной страницы.
- [ ] Loading screen/progress для тяжёлых dynamic modules и моделей.

---

# P2 — Расширение после стабильного v1.0

Эти задачи не должны задерживать первый стабильный релиз.

## Advanced modeling

- [ ] Curves / paths.
- [ ] Text object → mesh.
- [ ] Lattice/simple deformation tools.
- [ ] Geometry Nodes-подобный procedural graph — только отдельным большим этапом.
- [ ] Sculpting — отдельный продуктовый этап, не часть v1.

## Procedural asset generators

- [ ] Cliff.
- [ ] Bush.
- [ ] Fence.
- [ ] Pier.
- [ ] Road segment.
- [ ] Stairs.
- [ ] Arch.
- [ ] Pipe/tube.
- [ ] Roof.
- [ ] Door/window.
- [ ] Wheel.
- [ ] Gear.
- [ ] Terrain tile.
- [ ] Parametric presets и random seed.

## Advanced UV

- [ ] Multiple UV sets editing.
- [ ] Lightmap UV generation.
- [ ] UDIM — только если появится реальный use-case и понятный export policy.

## Advanced animation

- [ ] Constraints.
- [ ] Drivers.
- [ ] NLA-like clip sequencing.
- [ ] Rig/bone editing — отдельная архитектура.

---

# Release gates v1.0

`v1.0` можно считать готовым только когда одновременно выполнены все пункты:

- [ ] P0 Production Integrity закрыт.
- [ ] Полный smoke-test GitHub Pages пройден минимум в Chrome/Edge/Firefox desktop.
- [ ] Diagnostics на golden fixtures не содержит необъяснённых `FAIL`.
- [ ] Нет известного сценария, где поддерживаемая операция молча теряет UV/material/animation/project data.
- [ ] `.gluestack` migration/recovery проверены минимум на текущей и предыдущей версии формата.
- [ ] Import → edit → save → reopen → export → reimport пройден на golden fixtures.
- [ ] Повторный project load не оставляет stale selection/gizmo/resources.
- [ ] Game Ready report совпадает с реально экспортированным GLB.
- [ ] README содержит только актуальное описание, возможности, ограничения, Pages link, лицензии и ссылку на roadmap.
- [ ] `THIRD_PARTY_LICENSES.md` соответствует реально подключённым зависимостям.
- [ ] В репозитории нет дублирующих старых реализаций, забытых prototype-файлов и неиспользуемых assets.
- [ ] `portfolio.png`, favicon/PWA assets и публичные metadata соответствуют текущему продукту.

## Следующий порядок работ

1. **P0 browser QA + golden fixtures + project data-loss protection.**
2. **Advanced UV unwrap/packing.**
3. **Modifier Stack production UX.**
4. **Game Ready optimizer v2 + LOD policy.**
5. **Import/export compatibility hardening.**
6. **Performance/Workers.**
7. **Graph Editor и P1 modeling UX.**
8. **Release audit → v1.0.**

Если новая задача не относится к P0/P1 и не исправляет реальный дефект, она не должна вытеснять release blockers из этого порядка.

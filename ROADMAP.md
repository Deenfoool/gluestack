# Roadmap gluestack

Цель — браузерный Blender-подобный моделлер для создания, редактирования и экспорта игровых `.glb` без backend.

## Этап 0 — фундамент
- [x] Статическое приложение для GitHub Pages.
- [x] Blender-подобная раскладка: меню, toolbar, viewport, Outliner, Properties.
- [x] Three.js viewport, камера, сетка и освещение.
- [x] Выбор объектов и Move / Rotate / Scale gizmo.
- [x] Создание базовых примитивов.
- [x] Импорт `.glb/.gltf` и экспорт `.glb`.
- [x] `.gltf` с внешними `.bin`/текстурами через multi-file import и локальный URL resolver.

## Этап 1 — Object Mode
- [x] Undo / Redo с общей историей операций.
- [x] Collections, parenting и иерархия Outliner.
- [x] Duplicate, Join, Separate, Apply Transform, Origin/Pivot.
- [x] Blender-подобный ввод `G X 2`, `R Z 90`, `S 2`.
- [x] Базовый snapping к сетке.
- [x] Scene/Camera state входит в Undo / Redo: фон, exposure, камера, orbit target и рабочее освещение.

## Этап 2 — Edit Mode
- [x] Переключение Object / Edit через `Tab`.
- [x] Vertex / Edge / Face selection (`1 / 2 / 3`) и multi-select.
- [x] `G / R / S` для выбранных компонентов и transform gizmo.
- [x] Работа с indexed и non-indexed mesh через логические сваренные вершины без разрушения существующих UV-швов при обычном transform.
- [x] Extrude Faces, Inset Face, Merge at Center, Fill Edge Loop.
- [x] Delete Vertex / Edge / Face с пересборкой валидной геометрии.
- [x] Recalculate / Flip Normals.
- [x] Bevel Face (базовый) и Dissolve Vertex / Edge.
- [x] Loop Cut по quad-strip.
- [x] Интерактивный Knife: сегмент между двумя точками на граничных рёбрах одной грани.
- [x] Сохранение UV и дополнительных BufferAttributes при topology-editing; новые corner-значения интерполируются. Skinned Mesh и Morph Mesh не допускаются в destructive Edit Mode, если операция потеряет связанные данные.

## Этап 3 — Modifiers
- [x] Mirror X / Y / Z.
- [x] Array с Count и XYZ Offset.
- [x] Bevel Modifier: базовый manifold chamfer без Segments/Profile.
- [x] Solidify.
- [x] Loop-style Subdivision, 1–3 уровня.
- [x] Decimate через Three.js r180 SimplifyModifier + Triangulate / Normalize.
- [x] Boolean Union / Difference / Intersect для watertight/two-manifold Mesh через three-bvh-csg. Cutter сохраняется.

Модификаторы на текущем этапе применяются destructive-операцией с общей Undo/Redo историей. QA-защита блокирует операции, если текущая реализация потеряет custom attributes или morph data. Decimate использует общий group-preserving simplification pipeline: geometry groups и их `materialIndex` сохраняются для multi-material Mesh. Поддерживаемые атрибуты: `position`, `uv`, `normal`, `tangent`, `color`; `uv1+`, skin/custom attributes блокируются.

## Этап 4 — UV Editing
- [x] Отдельный workspace UV Editing с UV canvas и существующим Three.js viewport без второго renderer.
- [x] UV Vertex / Edge / Island selection, Shift multi-select и Select All.
- [x] Mark Seam / Clear Seam для выделенных рёбер в Edit Mode; отдельная очистка всех seams.
- [x] Unwrap по seam-islands и Smart UV Project.
- [x] Cube / Cylinder / Sphere / View projection.
- [x] Move / Rotate / Scale выбранных UV; drag-move непосредственно в UV Editor.
- [x] Pack Islands и Average Island Scale.
- [x] Фоновая checker/reference texture для контроля развёртки.

UV Editing работает непосредственно с `geometry.attributes.uv`, поэтому изменённые координаты попадают в экспортируемый `.glb`. Для независимых corner UV индексированная геометрия при первом UV-редактировании переводится в non-indexed представление с общей Undo/Redo историей.

## Этап 5 — материалы и текстуры
- [x] PBR-материалы на `MeshStandardMaterial`, совместимые с glTF/GLB pipeline.
- [x] Base Color, Normal, Roughness, Metallic, AO, Emissive и Opacity.
- [x] Загрузка, замена и очистка текстур PNG/JPEG/WebP.
- [x] Material Preview во viewport.
- [x] Texture Offset / Scale / Rotation и Base Color preview в UV Editor.
- [x] Shared textures освобождаются только после проверки ссылок остальных Mesh.
- [x] Multi-material editing: выбор material slot, независимые PBR/texture/transform параметры каждого slot.
- [x] Texture Paint использует выбранный material slot и игнорирует грани других slots.
- [x] Multi-channel Texture Paint: Base Color / Roughness / Metallic / Normal / Emissive с корректным color space и scalar brush для Roughness/Metallic.

Материал редактируется непосредственно на Mesh, поэтому параметры и карты передаются существующему `GLTFExporter`. Material groups и количество material slots теперь входят в Diagnostics round-trip.

## Этап 6 — проекты
- [x] Локальные именованные проекты через IndexedDB.
- [x] Debounced autosave и восстановление последней сессии.
- [x] Собственный бинарный `.gluestack`: GLB + редакторские метаданные (камера, selection, snap, userData/extras).
- [x] History snapshots клонируют Skinned hierarchy через `SkeletonUtils.clone`, а CanvasTexture — отдельным canvas snapshot.
- [x] После открытия `.gluestack` обычные Mesh снова получают независимые editable geometry/material resources.

Один и тот же project container используется для скачиваемого файла и IndexedDB, поэтому локальный snapshot и файл проекта не расходятся по формату. Текстуры и animation clips хранятся внутри вложенного GLB.

## Этап 7 — Game Ready
- [x] Статистика meshes / vertices / triangles / materials / textures и оценка texture RAM.
- [x] Проверка missing normals, non-unit scale, пустых meshes, NaN/Infinity и слишком крупных текстур.
- [x] Optimize Scene: merge compatible vertices, сохранение валидных normals и dedup эквивалентных материалов.
- [x] Генерация LOD0/LOD1/LOD2 и расчёт реального размера итогового `.glb` через `GLTFExporter`.
- [x] UV-safe LOD/Decimate с атрибутами, поддерживаемыми Three.js r180 SimplifyModifier (`position`, `uv`, `normal`, `tangent`, `color`).
- [x] Multi-material-aware LOD/Decimate: simplification выполняется по geometry groups с восстановлением исходных `materialIndex` после merge.
- [x] Diagnostics проверяет GLB export→parse, UV/PBR/material groups/texture slots/extras, animation clips/tracks и `.gluestack` metadata/payload.

LOD-уровни получают `userData.gluestackLOD`; LOD1/LOD2 скрываются во viewport, но остаются в сцене. Morph targets, InstancedMesh и неподдерживаемые custom attributes по-прежнему блокируются до специализированных pipeline.

## Этап 8 — расширение
- [x] Texture Paint по Base Color прямо на 3D-модели через raycast + UV; настройки Color / Size / Strength.
- [x] Procedural low-poly generators: Rock, Island, Tree, Crate.
- [x] Scene/Camera controls: фон, рабочее освещение, FOV/Near/Far, Reset View, добавление экспортируемых Point/Directional Light и Camera from View.
- [x] Animation clip import/export/project/history round-trip через штатный `GLTFExporter.animations`.
- [x] Animation preview: список clips, Play/Stop и скорость.
- [x] Rename retargets animation track paths; Delete/Join/Separate удаляют tracks только для реально исчезнувших узлов.
- [x] Базовый Transform Keyframe Editor: Create/Delete Clip, time scrub и Position/Quaternion/Scale keys выбранного объекта с Undo/Redo.

Animation pipeline сохраняет и проигрывает clips и теперь умеет создавать transform-анимацию. Полноценный Dope Sheet/Graph Editor, удаление отдельных keys и редактирование interpolation остаются отдельным этапом.

## После MVP
- [ ] Полный browser smoke-test всех workspaces и операций на GitHub Pages.
- [x] Runtime failure isolation: сбой дополнительного feature-модуля не должен валить Object/Edit Mode.
- [x] Safe disposal shared geometry/material/texture resources.
- [x] Защита destructive-операций от молчаливой потери glTF attributes.
- [ ] Advanced animation editor: Dope Sheet, удаление/перемещение отдельных keyframes, interpolation/easing.
- [x] Multi-material-aware LOD/Decimate с сохранением geometry groups.
- [ ] Неразрушающий modifier stack, сохраняемый в `.gluestack`.
- [x] Texture Paint для Normal / Roughness / Metallic / Emissive.
- [ ] Улучшенные UV unwrap/packing алгоритмы для сложных production mesh.
- [ ] Расширенная оптимизация GLB и runtime LOD policy.

Неактуальные реализации не сохраняются рядом с новыми: заменённый код удаляется в том же изменении, а история остаётся в Git.

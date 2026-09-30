# Roadmap gluestack

Цель — браузерный Blender-подобный моделлер для создания, редактирования и экспорта игровых `.glb` без backend.

## Этап 0 — фундамент
- [x] Статическое приложение для GitHub Pages.
- [x] Blender-подобная раскладка: меню, toolbar, viewport, Outliner, Properties.
- [x] Three.js viewport, камера, сетка и освещение.
- [x] Выбор объектов и Move / Rotate / Scale gizmo.
- [x] Создание базовых примитивов.
- [x] Импорт `.glb/.gltf` и экспорт `.glb`.

## Этап 1 — Object Mode
- [x] Undo / Redo с общей историей операций.
- [x] Collections, parenting и иерархия Outliner.
- [x] Duplicate, Join, Separate, Apply Transform, Origin/Pivot.
- [x] Blender-подобный ввод `G X 2`, `R Z 90`, `S 2`.
- [x] Базовый snapping к сетке.

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
- [x] Сохранение UV и дополнительных BufferAttributes при topology-editing; новые corner-значения интерполируются. Skinned Mesh не редактируется, tangents после изменения топологии не переиспользуются.

## Этап 3 — Modifiers
- [x] Mirror X / Y / Z.
- [x] Array с Count и XYZ Offset.
- [x] Bevel Modifier: базовый manifold chamfer без Segments/Profile.
- [x] Solidify.
- [x] Loop-style Subdivision, 1–3 уровня.
- [x] Decimate через Three.js SimplifyModifier + Triangulate / Normalize.
- [x] Boolean Union / Difference / Intersect для watertight/two-manifold Mesh через three-bvh-csg. Cutter сохраняется.

Модификаторы на текущем этапе применяются destructive-операцией с общей Undo/Redo историей. Неразрушающий стек будет логично добавлять вместе с полноценным форматом проекта, чтобы параметры стека корректно сохранялись между сессиями.

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

Материал редактируется непосредственно на Mesh, поэтому параметры и карты передаются существующему `GLTFExporter`. Для multi-material Mesh на текущем этапе Material Properties редактирует первый material slot.

## Этап 6 — проекты
- [x] Локальные именованные проекты через IndexedDB.
- [x] Debounced autosave и восстановление последней сессии.
- [x] Собственный бинарный `.gluestack`: GLB + редакторские метаданные (камера, selection, snap, userData/extras).

Один и тот же project container используется для скачиваемого файла и IndexedDB, поэтому локальный snapshot и файл проекта не расходятся по формату. Текстуры хранятся внутри вложенного GLB.

## Этап 7 — Game Ready
- [x] Статистика meshes / vertices / triangles / materials / textures и оценка texture RAM.
- [x] Проверка missing normals, non-unit scale, пустых meshes, NaN/Infinity и слишком крупных текстур.
- [x] Optimize Scene: merge compatible vertices, recalculated normals и dedup эквивалентных материалов.
- [x] Генерация LOD0/LOD1/LOD2 и расчёт реального размера итогового `.glb` через `GLTFExporter`.

LOD-уровни получают `userData.gluestackLOD`; LOD1/LOD2 скрываются во viewport, но остаются в сцене и экспортируются для дальнейшего выбора игровым runtime.

## Этап 8 — расширение
- [ ] Texture Paint.
- [ ] Procedural low-poly generators.
- [ ] Расширенная работа с освещением и камерой.

Неактуальные реализации не сохраняются рядом с новыми: заменённый код удаляется в том же изменении, а история остаётся в Git.

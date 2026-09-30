# Roadmap gluestack

Цель — браузерный Blender-подобный моделлер для создания, редактирования и экспорта игровых `.glb` без backend.

## Этап 0 — фундамент
- [x] Статическое приложение для GitHub Pages.
- [x] Blender-подобная раскладка: меню, toolbar, viewport, Outliner, Properties.
- [x] Three.js viewport, камера, сетка и освещение.
- [x] Выбор объектов и Move / Rotate / Scale gizmo.
- [x] Создание базовых примитивов.
- [x] Импорт `.glb/.gltf` и экспорт `.glb`.
- [x] Lucide icons.

## Этап 1 — Object Mode
- [x] Undo / Redo с общей историей операций.
- [x] Collections, parenting и иерархия Outliner.
- [x] Multi-select, Duplicate, Join, Separate Group, Apply Transform, Origin/Pivot.
- [x] Blender-подобный числовой ввод `G X 2`, `R Z 90`, `S 2`.
- [x] Базовый snapping для TransformControls.

## Этап 2 — Edit Mode
- [ ] Выбор Vertex / Edge / Face.
- [ ] Extrude, Inset, Bevel, Merge, Fill, Dissolve.
- [ ] Loop Cut и Knife.
- [ ] Recalculate / Flip Normals.
- [ ] Корректное редактирование индексированной mesh-топологии.

## Этап 3 — Modifiers
- [ ] Mirror.
- [ ] Array.
- [ ] Bevel.
- [ ] Solidify.
- [ ] Subdivision.
- [ ] Decimate / Triangulate.
- [ ] Boolean Union / Difference / Intersect.

## Этап 4 — UV Editing
- [ ] Отдельный workspace UV Editing.
- [ ] UV Vertex / Edge / Island selection.
- [ ] Mark Seam / Clear Seam.
- [ ] Unwrap и Smart UV Project.
- [ ] Cube / Cylinder / Sphere / View projection.
- [ ] Move / Rotate / Scale UV-островов.
- [ ] Pack Islands и Average Island Scale.

## Этап 5 — материалы и текстуры
- [ ] PBR-материалы glTF.
- [ ] Base Color, Normal, Roughness, Metallic, AO, Emissive.
- [ ] Загрузка и замена текстур.
- [ ] Material Preview.
- [ ] Texture transform и предпросмотр в UV Editor.

## Этап 6 — проекты
- [ ] Локальные проекты через IndexedDB.
- [ ] Autosave и восстановление сессии.
- [ ] Собственный формат проекта без потери редакторских данных.

## Этап 7 — Game Ready
- [ ] Статистика vertices / triangles / materials / textures.
- [ ] Проверка normals, transforms и пустых meshes.
- [ ] Оптимизация геометрии и материалов.
- [ ] LOD и контроль размера итогового `.glb`.

## Этап 8 — расширение
- [ ] Texture Paint.
- [ ] Procedural low-poly generators.
- [ ] Расширенная работа с освещением и камерой.

Неактуальные реализации не сохраняются рядом с новыми: заменённый код удаляется в том же изменении, а история остаётся в Git.

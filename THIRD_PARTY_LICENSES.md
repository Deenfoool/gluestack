# Лицензии сторонних компонентов

Проект использует сторонние компоненты и графические ресурсы.

## Three.js

- Проект: https://threejs.org/
- Репозиторий: https://github.com/mrdoob/three.js
- Лицензия: MIT
- Версия: `0.180.0`

## Lucide

- Проект: https://lucide.dev/
- Репозиторий: https://github.com/lucide-icons/lucide
- Лицензия: ISC
- Версия: `0.468.0`
- Использование: общие UI-иконки и fallback, если внешний Icons8 CDN недоступен.

## Icons8

- Проект: https://icons8.com/
- Каталог: https://icons8.com/icons
- CDN / renderer: https://img.icons8.com/
- Условия бесплатного использования: https://icons8.com/license
- Использование: основные иконки инструментов Move / Rotate / Scale / Extrude / Inset / Bevel / Loop Cut / Knife / Merge / Dissolve / Fill / Snap / Duplicate / Delete и UV transform tools.
- Стиль: монохромное семейство Icons8 iOS Glyph.
- Attribution: в интерфейсе gluestack выводится постоянная ссылка `Icons by Icons8`.

Источники выбранных иконок:

- Move: https://icons8.com/icon/78763/move
- 3D Rotate: https://icons8.com/icon/78525/3d-rotate
- Resize / Scale: https://icons8.com/icon/78731/resize
- 3D Object / Extrude: https://icons8.com/icon/78554/3d-object
- Indent / Inset: https://icons8.com/icon/78886/indent
- Chamfer / Bevel: https://icons8.com/icon/77809/chamfer
- Split / Loop Cut: https://icons8.com/icon/62915/split
- Knife: https://icons8.com/icon/66808/knife
- Merge: https://icons8.com/icon/62973/merge
- Erase / Dissolve: https://icons8.com/icon/78647/erase
- Fill Color: https://icons8.com/icon/78740/fill-color
- Magnet / Snap: https://icons8.com/icon/79942/magnet
- Copy / Duplicate: https://icons8.com/icon/78580/copy-to-clipboard
- Delete: https://icons8.com/icon/67884/delete

## three-bvh-csg

- Репозиторий: https://github.com/gkjohnson/three-bvh-csg
- Лицензия: MIT
- Версия: `0.0.18`
- Использование: Boolean Union / Difference / Intersect для watertight mesh.

## three-mesh-bvh

- Репозиторий: https://github.com/gkjohnson/three-mesh-bvh
- Лицензия: MIT
- Версия: `0.9.15`
- Использование: peer dependency для `three-bvh-csg`.

JavaScript-зависимости загружаются закреплёнными версиями через jsDelivr. Icons8 tool icons загружаются через официальный Icons8 renderer CDN; при ошибке загрузки интерфейс автоматически возвращается к локально подключённым Lucide-иконкам.

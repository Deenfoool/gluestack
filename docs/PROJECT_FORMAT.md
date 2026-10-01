# `.gluestack` project format

`.gluestack` — бинарный editor-project container. Он не заменяет glTF/GLB: внутри контейнера всегда хранится обычный бинарный GLB payload, а перед ним — небольшой JSON header с editor-state.

## Container layout

```text
0                         magic: ASCII `GLUESTACK1\n`
magic.length              metadataLength: uint32 little-endian
magic.length + 4          UTF-8 JSON metadata, `metadataLength` bytes
...                       binary GLB payload (`glTF` magic 0x46546C67)
```

`PROJECT_MAGIC` описывает версию самого контейнера. Сейчас она остаётся `GLUESTACK1`, потому что layout не менялся.

## Metadata

Обязательные поля текущей версии:

```json
{
  "format": "gluestack-project",
  "version": 2,
  "name": "Project name",
  "savedAt": "ISO-8601",
  "camera": {},
  "viewport": {},
  "selection": {},
  "editor": {},
  "integrity": {}
}
```

`version` относится к editor metadata/data model, а не к container magic.

### v2

- camera / viewport state;
- selection + active object ID;
- snap/editor state;
- project integrity summary;
- animation clips внутри GLB payload;
- non-destructive modifier stack: source geometry + descriptors сохраняются в project GLB/extras и после загрузки заново вычисляют evaluated geometry.

## Version policy

- текущая версия задаётся только `CURRENT_PROJECT_VERSION` в `src/projects/format.js`;
- migration выполняется последовательно через `MIGRATIONS`;
- старый проект сначала полностью мигрируется в памяти и только после этого допускается к загрузке;
- файл новее поддерживаемой версии блокируется с понятной ошибкой;
- неизвестный format или повреждённый header/GLB блокируется до замены live-сцены;
- новая версия не должна добавляться отдельными version-checks по разным модулям — только через общий format/migration layer.

## Runtime GLB vs project GLB

Обычный `Export GLB` — game/runtime export. Из него удаляются editor-only `gluestack*` / `__gluestack*` userData keys.

`.gluestack` обязан сохранять editor-only состояние, необходимое для продолжения редактирования. Поэтому его внутренний GLB и обычный runtime GLB намеренно не идентичны.

## Integrity rule

Перед заменой текущей сцены loader обязан успешно выполнить:

1. container/header validation;
2. metadata normalization/migration;
3. GLB magic validation;
4. `GLTFLoader.parse`;
5. базовую scene/geometry validation.

Только после этого подготовленная сцена может заменить live project.

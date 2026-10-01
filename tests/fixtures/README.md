# Golden fixtures

Эта папка предназначена только для regression/Diagnostics и не является production asset path gluestack.

`golden-fixtures.js` создаёт в памяти постоянный набор сцен для проверки `GLTFExporter → GLTFLoader`:

- primitive single-material;
- multi-material geometry groups;
- UV islands;
- Base Color / Normal / Roughness / Metallic / Emissive textures;
- transform animation hierarchy;
- SkinnedMesh;
- morph targets;
- custom `_GOLDEN` BufferAttribute;
- high-poly mesh;
- malformed GLTF negative case.

`external/` содержит настоящий multi-file fixture:

- `fixture.gltf`;
- `mesh.bin`;
- `albedo.png`.

Diagnostics загружает эти три файла с GitHub Pages, превращает их в локальные `File`-объекты и прогоняет через тот же `importer.parseFiles()`/URL resolver, который используется пользовательским File Import. Проверка не добавляет fixture в live project scene.

Все in-memory fixtures создаются только по запросу Diagnostics, экспортируются, повторно загружаются и после проверки освобождают свои geometry/material/texture resources.

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

Fixtures не изменяют live project scene. Они создаются только по запросу Diagnostics, экспортируются, повторно загружаются и после проверки освобождают свои geometry/material/texture resources.

Отдельный static fixture для multi-file `.gltf + .bin + textures` остаётся обязательным P0 пунктом: он нужен именно для проверки file-selection/URI resolver, которую нельзя полноценно заменить in-memory exporter round-trip.

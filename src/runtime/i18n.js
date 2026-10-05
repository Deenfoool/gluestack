const SETTINGS_KEY = 'gluestack.settings.v1';

const RU = Object.freeze({
  // Main menus and common actions
  'File': 'Файл',
  'Edit': 'Правка',
  'Add': 'Добавить',
  'Object': 'Объект',
  'Mesh': 'Сетка',
  'Animation': 'Анимация',
  'Scene': 'Сцена',
  'Help': 'Справка',
  'New': 'Новый проект',
  'Import GLB/GLTF…': 'Импорт GLB/GLTF…',
  'Export GLB…': 'Экспорт GLB…',
  'Export Selected GLB': 'Экспорт выбранного GLB',
  'Save Project': 'Сохранить проект',
  'Save Project As…': 'Сохранить проект как…',
  'Open Project…': 'Открыть проект…',
  'Open Local Project…': 'Открыть локальный проект…',
  'Recover Autosave': 'Восстановить автосохранение',
  'Recover Previous Autosave': 'Восстановить предыдущее автосохранение',
  'Settings…': 'Настройки…',
  'Undo': 'Отменить',
  'Redo': 'Повторить',
  'Import': 'Импорт',
  'Export': 'Экспорт',
  'Reset': 'Сбросить',
  'Done': 'Готово',
  'Close': 'Закрыть',
  'Cancel': 'Отмена',
  'Apply': 'Применить',
  'Delete': 'Удалить',
  'Duplicate': 'Дублировать',
  'Collection': 'Коллекция',
  'Parent to Active': 'Привязать к активному',
  'Clear Parent': 'Убрать родителя',
  'Join': 'Объединить',
  'Separate Group': 'Разделить группу',
  'Apply Transform': 'Применить трансформации',
  'Origin to Geometry': 'Origin к геометрии',
  'Delete Selected': 'Удалить выбранное',

  // Add menu
  'Mesh › Cube': 'Сетка › Куб',
  'Mesh › UV Sphere': 'Сетка › UV-сфера',
  'Mesh › Cylinder': 'Сетка › Цилиндр',
  'Mesh › Cone': 'Сетка › Конус',
  'Mesh › Plane': 'Сетка › Плоскость',
  'Mesh › Torus': 'Сетка › Тор',
  'Procedural › Low Poly Rock': 'Процедурное › Low Poly камень',
  'Procedural › Island': 'Процедурное › Остров',
  'Procedural › Tree': 'Процедурное › Дерево',
  'Procedural › Crate': 'Процедурное › Ящик',

  // Edit mode / modeling
  'Extrude Faces': 'Экструдировать грани',
  'Inset Face': 'Вставка грани',
  'Bevel Face': 'Фаска грани',
  'Loop Cut': 'Кольцевой разрез',
  'Knife': 'Нож',
  'Merge at Center': 'Объединить в центре',
  'Dissolve Vertex / Edge': 'Растворить вершину / ребро',
  'Fill Edge Loop': 'Заполнить контур',
  'Recalculate Normals': 'Пересчитать нормали',
  'Flip Normals': 'Развернуть нормали',
  'Move': 'Перемещение',
  'Rotate': 'Вращение',
  'Scale': 'Масштаб',
  'Snap': 'Привязка',
  'Object Mode': 'Режим объекта',
  'Edit Mode': 'Режим редактирования',
  'Vertex Select': 'Выбор вершин',
  'Edge Select': 'Выбор рёбер',
  'Face Select': 'Выбор граней',
  'Frame Selected': 'Показать выбранное',
  'Frame All': 'Показать всё',
  'Solid': 'Сплошной режим',
  'Material Preview': 'Предпросмотр материала',
  'Material Preview — по roadmap': 'Предпросмотр материала — по roadmap',
  'Toggle Object/Edit Mode': 'Переключить Object/Edit Mode',
  'Shift+Click multi-select · MMB orbit · Shift+MMB pan · Wheel zoom': 'Shift+клик — мультивыбор · СКМ — вращение · Shift+СКМ — панорама · Колесо — масштаб',
  '1/2/3 Select · Ctrl+B Bevel · Ctrl+R Loop Cut · K Knife · Ctrl+X Dissolve': '1/2/3 — выбор · Ctrl+B — фаска · Ctrl+R — разрез · K — нож · Ctrl+X — растворить',

  // Workspaces / panels
  'Layout': 'Компоновка',
  'Modeling': 'Моделирование',
  'UV Editing': 'UV-развёртка',
  'Shading': 'Шейдинг',
  'Texture Paint': 'Рисование текстуры',
  'Scene Collection': 'Коллекция сцены',
  'New Collection': 'Новая коллекция',
  'Outliner': 'Структура сцены',
  'Properties tabs': 'Вкладки свойств',
  'Properties': 'Свойства',
  'Name': 'Имя',
  'Transform': 'Трансформации',
  'Location': 'Положение',
  'Rotation': 'Вращение',
  'Modifiers': 'Модификаторы',
  'Material': 'Материал',
  'Material — по roadmap': 'Материал — по roadmap',
  'Выберите объект': 'Выберите объект',
  'Objects': 'Объекты',
  'Selected': 'Выбрано',
  'Vertices': 'Вершины',
  'Triangles': 'Треугольники',

  // Modifiers
  'Mirror': 'Зеркало',
  'Array': 'Массив',
  'Bevel': 'Фаска',
  'Solidify': 'Толщина',
  'Subdivision': 'Подразделение',
  'Decimate / Triangulate': 'Упрощение / Триангуляция',
  'Boolean': 'Булево',
  'Count': 'Количество',
  'Offset': 'Смещение',
  'Factor': 'Коэффициент',
  'Thickness': 'Толщина',
  'Levels': 'Уровни',
  'Ratio': 'Доля',
  'Apply Array': 'Применить массив',
  'Apply Bevel': 'Применить фаску',
  'Apply Solidify': 'Применить толщину',
  'Apply Subdivision': 'Применить подразделение',
  'Apply Decimate': 'Применить упрощение',
  'Triangulate / Normalize': 'Триангулировать / Нормализовать',
  'Union': 'Объединение',
  'Intersect': 'Пересечение',
  'Enable': 'Включить',
  'Disable': 'Выключить',
  'Apply Stack': 'Применить стек',
  'Clear Stack': 'Очистить стек',
  'Duplicate Modifier': 'Дублировать модификатор',
  'Bake Through Here': 'Запечь до этого места',

  // UV
  'UV Editor': 'UV-редактор',
  'Vertex': 'Вершины',
  'Edge': 'Рёбра',
  'Island': 'Остров',
  'Select All': 'Выбрать всё',
  'Deselect All': 'Снять выделение',
  'Invert Selection': 'Инвертировать выделение',
  'Mark Seam': 'Пометить шов',
  'Clear Seam': 'Убрать шов',
  'Clear Seams': 'Очистить швы',
  'Unwrap': 'Развернуть',
  'Smart UV Project': 'Умная UV-развёртка',
  'Cube Projection': 'Кубическая проекция',
  'Sphere Projection': 'Сферическая проекция',
  'Cylinder Projection': 'Цилиндрическая проекция',
  'Project From View': 'Проекция из вида',
  'Pack Islands': 'Упаковать острова',
  'Pack Selected': 'Упаковать выбранное',
  'Average Island Scale': 'Усреднить масштаб островов',
  'Relax': 'Расслабить',
  'Stretch': 'Растяжение',
  'Texel Density': 'Плотность текселей',
  'Normalize 0..1': 'Нормализовать 0..1',
  'Stitch / Weld': 'Сшить / Сварить',
  'Reference Texture': 'Референсная текстура',

  // Materials / paint
  'Materials': 'Материалы',
  'Base Color': 'Базовый цвет',
  'Metallic': 'Металличность',
  'Roughness': 'Шероховатость',
  'Opacity': 'Прозрачность',
  'Emissive': 'Свечение',
  'Emissive Intensity': 'Интенсивность свечения',
  'Normal Map': 'Карта нормалей',
  'Roughness Map': 'Карта шероховатости',
  'Metallic Map': 'Карта металличности',
  'AO Map': 'Карта AO',
  'Emissive Map': 'Карта свечения',
  'Clear Textures': 'Очистить текстуры',
  'Texture Transform': 'Трансформация текстуры',
  'Color': 'Цвет',
  'Size': 'Размер',
  'Strength': 'Сила',
  'Value': 'Значение',
  'Fill White': 'Залить белым',

  // Projects / diagnostics
  'Project name': 'Название проекта',
  'Untitled': 'Без названия',
  'Unsaved': 'Не сохранено',
  '● Unsaved': '● Не сохранено',
  'Diagnostics': 'Диагностика',
  'Run Diagnostics': 'Запустить диагностику',
  'Run v1 Release Gate': 'Запустить проверку релиза v1',
  'Metadata Audit': 'Аудит метаданных',
  'Golden Fixtures': 'Эталонные тесты',
  'UV Golden Fixtures': 'Эталонные UV-тесты',
  'Modifier Stack Diagnostics': 'Диагностика стека модификаторов',
  'Import / Export Diagnostics': 'Диагностика импорта / экспорта',
  'Destructive Guard Diagnostics': 'Проверка защиты данных',
  'PASS': 'ПРОЙДЕНО',
  'FAIL': 'ОШИБКА',
  'WARN': 'ПРЕДУПРЕЖДЕНИЕ',

  // Game ready
  'Game Ready': 'Подготовка для игры',
  'Analyze': 'Анализировать',
  'Optimize Scene': 'Оптимизировать сцену',
  'Generate LOD': 'Создать LOD',
  'Generate LODs': 'Создать LOD',
  'Replace LOD Chain': 'Заменить цепочку LOD',
  'Cleanup Preview': 'Предпросмотр очистки',
  'Export Profile': 'Профиль экспорта',
  'Texture Memory': 'Память текстур',
  'Estimated GLB Size': 'Расчётный размер GLB',
  'Issues': 'Проблемы',
  'No issues': 'Проблем не найдено',

  // Animation
  'Animation Editor': 'Редактор анимации',
  'Dope Sheet': 'Dope Sheet',
  'Clip': 'Клип',
  'New Clip': 'Новый клип',
  'Delete Clip': 'Удалить клип',
  'Play': 'Воспроизвести',
  'Stop': 'Остановить',
  'Speed': 'Скорость',
  'Time': 'Время',
  'Position': 'Положение',
  'Quaternion': 'Кватернион',
  'Linear': 'Линейная',
  'Step': 'Ступенчатая',
  'Smooth': 'Плавная',

  // Scene controls
  'Viewport': 'Окно 3D-вида',
  'Background': 'Фон',
  'Hemisphere': 'Полусферический свет',
  'Key Light': 'Основной свет',
  'Fill Light': 'Заполняющий свет',
  'Camera': 'Камера',
  'Near': 'Ближняя плоскость',
  'Far': 'Дальняя плоскость',
  'Reset View': 'Сбросить вид',
  'Add to exported scene': 'Добавить в экспортируемую сцену',
  'Point Light': 'Точечный свет',
  'Sun / Directional': 'Солнце / Направленный свет',
  'Camera from View': 'Камера из текущего вида',

  // Settings
  'Settings': 'Настройки',
  'gluestack preferences': 'параметры gluestack',
  'Settings categories': 'Категории настроек',
  'General': 'Общие',
  'Language': 'Язык',
  'Interface language. Applied immediately.': 'Язык интерфейса. Применяется сразу.',
  'Global editor preferences. They are stored locally in this browser and are not written into GLB files.': 'Глобальные настройки редактора. Они хранятся локально в браузере и не записываются в GLB-файлы.',
  'Autosave': 'Автосохранение',
  'Save dirty projects to IndexedDB automatically.': 'Автоматически сохранять изменённые проекты в IndexedDB.',
  'Autosave delay': 'Задержка автосохранения',
  'Delay after the last edit before autosave starts.': 'Задержка после последнего изменения перед автосохранением.',
  'Rendering and camera defaults applied immediately.': 'Параметры отображения и камеры применяются сразу.',
  'Viewport clear color.': 'Цвет фона 3D-вида.',
  'Exposure': 'Экспозиция',
  'ACES tone mapping exposure.': 'Экспозиция ACES tone mapping.',
  'Grid': 'Сетка',
  'Show the world grid helper.': 'Показывать мировую сетку.',
  'Axes': 'Оси',
  'Show XYZ axes at the world origin.': 'Показывать оси XYZ в начале координат.',
  'Camera FOV': 'Угол обзора камеры',
  'Perspective field of view.': 'Угол обзора перспективной камеры.',
  'Near clip': 'Ближняя отсечка',
  'Closest visible camera distance.': 'Минимальная видимая дистанция камеры.',
  'Far clip': 'Дальняя отсечка',
  'Farthest visible camera distance.': 'Максимальная видимая дистанция камеры.',
  'Pixel ratio limit': 'Лимит Pixel Ratio',
  'Caps renderer DPR to balance sharpness and GPU cost.': 'Ограничивает DPR для баланса чёткости и нагрузки на GPU.',
  'Gizmo size': 'Размер гизмо',
  'Move / Rotate / Scale handle size.': 'Размер манипуляторов перемещения / вращения / масштаба.',
  'Navigation': 'Навигация',
  'OrbitControls behaviour for the 3D viewport.': 'Поведение навигации OrbitControls в 3D-виде.',
  'Damping': 'Инерция',
  'Smooth camera movement after input.': 'Плавное продолжение движения камеры после ввода.',
  'Damping factor': 'Коэффициент инерции',
  'Higher values stop movement faster.': 'Чем выше значение, тем быстрее останавливается движение.',
  'Orbit speed': 'Скорость вращения',
  'Middle-mouse orbit sensitivity.': 'Чувствительность вращения средней кнопкой мыши.',
  'Pan speed': 'Скорость панорамы',
  'Shift + middle-mouse pan sensitivity.': 'Чувствительность панорамы Shift + СКМ.',
  'Zoom speed': 'Скорость приближения',
  'Mouse-wheel zoom sensitivity.': 'Чувствительность приближения колесом мыши.',
  'Snap increments used by the toolbar magnet and TransformControls.': 'Шаги привязки для магнита на панели и TransformControls.',
  'Move snap': 'Шаг перемещения',
  'Translation step in world units.': 'Шаг перемещения в мировых единицах.',
  'Rotation snap': 'Шаг вращения',
  'Rotation step when snapping is enabled.': 'Шаг вращения при включённой привязке.',
  'Scale snap': 'Шаг масштаба',
  'Scale increment when snapping is enabled.': 'Шаг изменения масштаба при включённой привязке.',
  'Saved locally': 'Сохранено локально',
  'Defaults restored': 'Настройки по умолчанию восстановлены',
  'Settings exported': 'Настройки экспортированы',
  'Reset all gluestack settings to defaults?': 'Сбросить все настройки gluestack к значениям по умолчанию?',

  // Existing Russian source strings mapped back to canonical English for English mode
  'Select an object': 'Выберите объект',
  'Ready': 'Готово',
  'Local projects are empty': 'Локальных проектов пока нет',
  'Choose project number:': 'Выберите номер проекта:',
  'Invalid project number': 'Некорректный номер проекта',
  'This is not a gluestack settings file': 'Это не файл настроек gluestack',
  'Settings applied': 'Настройки применены',
  'Snap enabled': 'Snap включён',
  'Snap disabled': 'Snap выключен',
  'View reset': 'Вид сброшен',

  // Existing mixed modifier/help text
  'Relative to local origin. Apply writes geometry; Ctrl+Z undoes.': 'Относительно локального origin. Apply записывает геометрию; Ctrl+Z отменяет.',
  'Chamfer for watertight manifold mesh. Currently without Segments/Profile.': 'Chamfer для watertight manifold mesh. Пока без Segments/Profile.',
  'Loop-style subdivision. Each level increases triangle count by about 4x.': 'Loop-style subdivision. Каждый уровень увеличивает число треугольников примерно в 4 раза.',
  'Decimate uses the official Three.js SimplifyModifier. Multi-material is not simplified yet.': 'Decimate использует официальный Three.js SimplifyModifier. Multi-material пока не упрощается.',
  'Select exactly 2 watertight Meshes. Active is A, second is B. Cutter B remains in the scene after Apply.': 'Выделите ровно 2 watertight Mesh. Активный — A, второй — B. Cutter B после Apply остаётся в сцене.',
});

const REVERSE_RU = new Map(Object.entries(RU).map(([en, ru]) => [ru, en]));
const textState = new WeakMap();
const attrState = new WeakMap();

function storedLanguage() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return 'ru';
    const parsed = JSON.parse(raw);
    const value = parsed?.settings?.general?.language ?? parsed?.general?.language;
    return value === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

function shouldSkip(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return true;
  if (element.closest('script,style,noscript,template,#outliner,[data-i18n-skip]')) return true;
  if (element.matches('input,textarea,[contenteditable="true"]')) return true;
  return false;
}

function canonical(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return REVERSE_RU.get(trimmed) ?? trimmed;
}

function translateExact(value, language) {
  const key = canonical(value);
  return language === 'ru' ? (RU[key] ?? value.trim()) : key;
}

function preserveWhitespace(source, translated) {
  const leading = source.match(/^\s*/)?.[0] ?? '';
  const trailing = source.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function translateTextNode(node, language) {
  if (shouldSkip(node)) return;
  const current = node.nodeValue ?? '';
  if (!current.trim()) return;
  let state = textState.get(node);
  if (!state || current !== state.rendered) {
    state = { canonical: canonical(current), rendered: current };
    textState.set(node, state);
  }
  const translated = preserveWhitespace(current, language === 'ru' ? (RU[state.canonical] ?? state.canonical) : state.canonical);
  state.rendered = translated;
  if (node.nodeValue !== translated) node.nodeValue = translated;
}

const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder'];

function translateAttributes(element, language) {
  if (shouldSkip(element)) return;
  let state = attrState.get(element);
  if (!state) {
    state = new Map();
    attrState.set(element, state);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute) ?? '';
    const previous = state.get(attribute);
    if (!previous || current !== previous.rendered) {
      state.set(attribute, { canonical: canonical(current), rendered: current });
    }
    const item = state.get(attribute);
    const translated = language === 'ru' ? (RU[item.canonical] ?? item.canonical) : item.canonical;
    item.rendered = translated;
    if (current !== translated) element.setAttribute(attribute, translated);
  }
}

function translateTree(root, language) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root, language);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, language);
    else translateAttributes(node, language);
    node = walker.nextNode();
  }
}

export function installI18n({ editor } = {}) {
  if (window.__gluestackI18n) return window.__gluestackI18n;

  const api = {
    language: storedLanguage(),
    getLanguage() { return api.language; },
    t(value) { return translateExact(value, api.language); },
    translate(root = document) { translateTree(root, api.language); },
    setLanguage(language, { announce = false } = {}) {
      const next = language === 'en' ? 'en' : 'ru';
      api.language = next;
      document.documentElement.lang = next;
      translateTree(document.body, next);
      window.dispatchEvent(new CustomEvent('gluestack:language-changed', { detail: { language: next } }));
      if (announce && editor?.events?.onStatus) {
        editor.events.onStatus(next === 'ru' ? 'Язык интерфейса: Русский' : 'Interface language: English');
      }
      return next;
    },
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => translateTree(node, api.language));
      } else if (record.type === 'characterData') {
        translateTextNode(record.target, api.language);
      } else if (record.type === 'attributes') {
        translateAttributes(record.target, api.language);
      }
    }
  });

  translateTree(document.body, api.language);
  document.documentElement.lang = api.language;
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
  });

  api.observer = observer;
  window.__gluestackI18n = api;
  return api;
}

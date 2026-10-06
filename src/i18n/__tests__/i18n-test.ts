import { translateStudioText } from '@/i18n'

describe('avatar studio translations', () => {
  it('uses English for static interface copy', () => {
    expect(translateStudioText('Couleur des yeux', 'en')).toBe('Eye color')
  })

  it('translates dynamic editor labels', () => {
    expect(translateStudioText('Modifier l’expression 08', 'en')).toBe('Edit expression 08')
    expect(translateStudioText('Sphère · porte les yeux', 'en')).toBe('Sphere · carries the eyes')
    expect(translateStudioText('Cône 1 copie', 'en')).toBe('Cone 1 copy')
  })

  it('keeps the original French copy in French', () => {
    expect(translateStudioText('Nouvel avatar', 'fr')).toBe('Nouvel avatar')
    expect(translateStudioText('sleeping', 'fr')).toBe('sommeil')
  })

  it('translates the studio interface and dynamic labels to Simplified Chinese', () => {
    expect(translateStudioText('Couleur des yeux', 'zh-CN')).toBe('眼睛颜色')
    expect(translateStudioText('Modifier l’expression 08', 'zh-CN')).toBe('编辑表情 08')
    expect(translateStudioText('sleeping', 'zh-CN')).toBe('睡眠')
  })

  it('translates every Photo Mode control to Simplified Chinese', () => {
    expect(translateStudioText('Mode photo', 'zh-CN')).toBe('照片模式')
    expect(translateStudioText('Dégradé radial', 'zh-CN')).toBe('径向渐变')
    expect(translateStudioText('Définition du mode photo', 'zh-CN')).toBe('照片模式分辨率')
    expect(translateStudioText('Télécharger en PNG', 'zh-CN')).toBe('下载 PNG')
    expect(translateStudioText('Prendre une photo', 'zh-CN')).toBe('拍照')
    expect(translateStudioText('Format d’export', 'zh-CN')).toBe('导出格式')
    expect(translateStudioText('Ouvrir le mode photo', 'en')).toBe('Open Photo Mode')
    expect(translateStudioText('Ouvrir le mode photo', 'zh-CN')).toBe('打开照片模式')
    expect(translateStudioText('Cadrage', 'en')).toBe('Framing')
    expect(translateStudioText('Recentrer le cadrage', 'zh-CN')).toBe('重置构图')
    expect(translateStudioText('Réinitialiser la pose et le cadrage', 'en')).toBe(
      'Reset pose and framing'
    )
    expect(translateStudioText('Réinitialiser la pose et le cadrage', 'zh-CN')).toBe(
      '重置姿态和构图'
    )
    expect(translateStudioText('Aléatoire', 'en')).toBe('Random')
    expect(translateStudioText('Aléatoire', 'zh-CN')).toBe('随机')
    expect(translateStudioText('Position, zoom et coins du cadre photo.', 'en')).toBe(
      'Position, zoom and photo frame corners.'
    )
    expect(translateStudioText('Orientation, regard, couleurs et perspective.', 'zh-CN')).toBe(
      '方向、视线、颜色和透视。'
    )
  })

  it('keeps runtime-export authoring copy synchronized in all three languages', () => {
    expect(translateStudioText('Clé sémantique', 'fr')).toBe('Clé sémantique')
    expect(translateStudioText('Clé sémantique', 'en')).toBe('Semantic key')
    expect(translateStudioText('Clé sémantique', 'zh-CN')).toBe('语义键')
    expect(translateStudioText('Exporter le JSON runtime', 'en')).toBe('Export runtime JSON')
    expect(translateStudioText('Exporter le JSON runtime', 'zh-CN')).toBe('导出运行时 JSON')
    expect(translateStudioText('JSON runtime + createAvatar', 'en')).toBe(
      'Runtime JSON + createAvatar'
    )
    expect(translateStudioText('JSON runtime + createAvatar', 'zh-CN')).toBe(
      '运行时 JSON + createAvatar'
    )
    expect(translateStudioText('JavaScript / ESM', 'en')).toBe('JavaScript / ESM')
    expect(translateStudioText('JSON runtime + avatar-web', 'zh-CN')).toBe(
      '运行时 JSON + avatar-web'
    )
    expect(translateStudioText('Guide d’utilisation de l’avatar JavaScript', 'en')).toBe(
      'JavaScript avatar usage guide'
    )
    expect(translateStudioText('Copier les instructions pour l’IA', 'en')).toBe(
      'Copy instruction for AI'
    )
    expect(translateStudioText('Copier les instructions pour l’IA', 'zh-CN')).toBe(
      '复制 AI 使用说明'
    )
    expect(translateStudioText('Preview de la définition exportée', 'en')).toBe(
      'Exported definition preview'
    )
    expect(translateStudioText('Animations exportées', 'zh-CN')).toBe('导出的动画')
    expect(
      translateStudioText(
        'Choisis les animations puis exporte le JSON runtime ou un package autonome.',
        'en'
      )
    ).toBe('Choose animations, then export runtime JSON or a standalone package.')
    expect(
      translateStudioText(
        'Choisis les animations puis exporte le JSON runtime ou un package autonome.',
        'zh-CN'
      )
    ).toBe('选择动画，然后导出运行时 JSON 或独立包。')
    expect(translateStudioText('Nouveau', 'en')).toBe('New')
    expect(translateStudioText('Nouveau', 'zh-CN')).toBe('新增')
    expect(translateStudioText('Lancer l’exemple', 'en')).toBe('Run example')
    expect(translateStudioText('Lancer l’exemple', 'zh-CN')).toBe('运行示例')
    expect(translateStudioText('Guide d’utilisation', 'en')).toBe('Usage guide')
    expect(translateStudioText('Guide d’utilisation', 'zh-CN')).toBe('使用指南')
    expect(translateStudioText('Le rendu Pixel est temporairement désactivé.', 'en')).toBe(
      'Pixel rendering is temporarily disabled.'
    )
    expect(translateStudioText('Le rendu Pixel est temporairement désactivé.', 'zh-CN')).toBe(
      '像素渲染暂时已禁用。'
    )
    expect(translateStudioText('Props de l’avatar', 'en')).toBe('Avatar props')
    expect(translateStudioText('Props de l’avatar', 'zh-CN')).toBe('头像 Props')
    expect(translateStudioText('Cible et lecture', 'en')).toBe('Target and playback')
    expect(translateStudioText('Présentation', 'zh-CN')).toBe('外观')
    expect(translateStudioText('API impérative', 'en')).toBe('Imperative API')
    expect(translateStudioText('API impérative', 'zh-CN')).toBe('命令式 API')
    expect(
      translateStudioText('Retourne l’animation, l’expression et le statut actifs.', 'en')
    ).toBe('Returns the active animation, expression and status.')
    expect(
      translateStudioText(
        'Utilise Avatar directement lorsque la définition est chargée à l’exécution ou change entre plusieurs avatars.',
        'en'
      )
    ).toBe(
      'Use Avatar directly when the definition is loaded at runtime or changes between multiple avatars.'
    )
    expect(
      translateStudioText(
        'createAvatar valide le JSON et retourne un composant dédié dont les clés d’animations sont typées.',
        'en'
      )
    ).toBe(
      'createAvatar validates the JSON and returns a dedicated component with typed animation keys.'
    )
    expect(
      translateStudioText(
        'Exporte le fichier .avatar.json utilisé par les nouveaux packages npm.',
        'en'
      )
    ).toBe('Export the .avatar.json file used by the new npm packages.')
    expect(
      translateStudioText(
        'Génère l’export ZIP autonome React ou JavaScript qui existait déjà.',
        'zh-CN'
      )
    ).toBe('生成原有的 React 或 JavaScript 独立 ZIP 导出。')
    expect(translateStudioText('Export runtime incomplet', 'en')).toBe(
      'Runtime export is incomplete'
    )
    expect(translateStudioText('Export runtime incomplet', 'zh-CN')).toBe('运行时导出不完整')
    expect(translateStudioText('Personnaliser', 'en')).toBe('Customize')
    expect(translateStudioText('Personnaliser', 'zh-CN')).toBe('自定义')
    expect(translateStudioText('Masquer la sélection', 'en')).toBe('Hide selection')
    expect(translateStudioText('Masquer la sélection', 'zh-CN')).toBe('隐藏选择')
    expect(translateStudioText('Expression de départ', 'en')).toBe('Starting expression')
    expect(translateStudioText('Expression de départ', 'zh-CN')).toBe('起始表情')
    expect(translateStudioText('Copier le JSON formaté', 'en')).toBe('Copy formatted JSON')
    expect(translateStudioText('Copier le JSON formaté', 'zh-CN')).toBe('复制格式化的 JSON')
    expect(translateStudioText('JSON runtime copié dans le presse-papiers.', 'en')).toBe(
      'Runtime JSON copied to the clipboard.'
    )
    expect(translateStudioText('JSON runtime copié dans le presse-papiers.', 'zh-CN')).toBe(
      '运行时 JSON 已复制到剪贴板。'
    )
  })

  it('keeps the DOT inspector sections synchronized in all three languages', () => {
    expect(translateStudioText('Forme', 'en')).toBe('Shape')
    expect(translateStudioText('Forme', 'zh-CN')).toBe('形状')
    expect(translateStudioText('Lumière', 'en')).toBe('Light')
    expect(translateStudioText('Lumière', 'zh-CN')).toBe('光线')
    expect(translateStudioText('Surface', 'en')).toBe('Surface')
    expect(translateStudioText('Surface', 'zh-CN')).toBe('表面')
    expect(translateStudioText('Avancé', 'en')).toBe('Advanced')
    expect(translateStudioText('Avancé', 'zh-CN')).toBe('高级')
    expect(translateStudioText('Mouvement', 'en')).toBe('Motion')
    expect(translateStudioText('Mouvement', 'zh-CN')).toBe('运动')
    expect(translateStudioText('Moteur de rendu', 'en')).toBe('Renderer')
    expect(translateStudioText('Moteur de rendu', 'zh-CN')).toBe('渲染器')
    expect(translateStudioText('Champ échantillonné', 'en')).toBe('Sampled field')
    expect(translateStudioText('Champ échantillonné', 'zh-CN')).toBe('采样场')
    expect(translateStudioText('Par pixel (filtre SVG)', 'en')).toBe('Per-pixel (SVG filter)')
    expect(translateStudioText('Par pixel (filtre SVG)', 'zh-CN')).toBe('逐像素（SVG 滤镜）')
    expect(translateStudioText('Rim', 'en')).toBe('Rim')
    expect(translateStudioText('Rim', 'zh-CN')).toBe('轮廓光')
    expect(translateStudioText('Sheen', 'en')).toBe('Sheen')
    expect(translateStudioText('Sheen', 'zh-CN')).toBe('光泽层')
    expect(translateStudioText('Grain', 'en')).toBe('Grain')
    expect(translateStudioText('Grain', 'zh-CN')).toBe('颗粒')
  })

  it('keeps the DOT inspector explanations synchronized in all three languages', () => {
    const silhouette = 'La silhouette du dot. Le grain la rend organique, pas bruyante.'
    expect(translateStudioText(silhouette, 'fr')).toBe(silhouette)
    expect(translateStudioText(silhouette, 'en')).toBe(
      'The dot silhouette. Grain makes it organic, not noisy.'
    )
    expect(translateStudioText(silhouette, 'zh-CN')).toBe(
      'dot 的轮廓。颗粒感让它显得有机，而不是杂乱。'
    )
    const light = 'La lumière appartient à la scène : le dot tourne, la lumière reste.'
    expect(translateStudioText(light, 'en')).toBe(
      'Light belongs to the scene: the dot turns, the light stays.'
    )
    expect(translateStudioText(light, 'zh-CN')).toBe('光线属于场景：dot 在转，光线不动。')
    const material = 'Le preset change tout le caractère de la surface, pas seulement la couleur.'
    expect(translateStudioText(material, 'en')).toBe(
      'A preset changes the whole character of the surface, not only its color.'
    )
    expect(translateStudioText(material, 'zh-CN')).toBe('预设改变的是整个表面的质感，不只是颜色。')
    const texture = 'La texture se voit de près, pas de loin. Au-delà, elle devient du bruit.'
    expect(translateStudioText(texture, 'en')).toBe(
      'Texture reads up close, not far away. Past that it is only noise.'
    )
    expect(translateStudioText(texture, 'zh-CN')).toBe(
      '纹理在近处可见，远处不可见。再远就只剩噪点。'
    )
    const advanced = 'Choix du moteur de rendu et outils de diagnostic.'
    expect(translateStudioText(advanced, 'en')).toBe('Renderer choice and diagnostic tools.')
    expect(translateStudioText(advanced, 'zh-CN')).toBe('渲染方式选择与诊断工具。')
    const locks = 'Les groupes verrouillés ne changent jamais. Le grain avance à chaque variante.'
    expect(translateStudioText(locks, 'en')).toBe(
      'Locked groups never change. Grain advances on every variant.'
    )
    expect(translateStudioText(locks, 'zh-CN')).toBe(
      '锁定的分组永不改变。每次切换变体都会推进颗粒。'
    )
  })

  it('covers every configured state description in English', () => {
    expect(translateStudioText('Rythme régulier et expressions concentrées.', 'en')).toBe(
      'Steady rhythm and focused expressions.'
    )
    expect(translateStudioText('Grandes expressions et transitions rapides.', 'en')).toBe(
      'Big expressions and fast transitions.'
    )
    expect(translateStudioText('Inclinaisons et forte asymétrie.', 'en')).toBe(
      'Tilts and strong asymmetry.'
    )
  })
})

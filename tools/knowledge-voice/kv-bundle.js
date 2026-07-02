/* KV Bundle - 2026-07-02T08:51:45Z */
/* --- textProcessingRules.js --- */
/** Layer 1 规则引擎 — 确定性文字处理 */
(function (global) {
  const SENSITIVE_KEYWORDS = [
    '退款', '赔偿', '投诉', '法律', '隐私', '起诉', '工商', '消协', '假货', '欺诈', '起火', '爆炸'
  ];

  const HTML_ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
  };

  function stripHtml(text) {
    if (!text) return '';
    let result = String(text);
    // 块级/列表标签换行，保留结构
    result = result.replace(/<\/?(h[1-6]|p|div|section|article|tr)[^>]*>/gi, '\n');
    result = result.replace(/<br\s*\/?>/gi, '\n');
    result = result.replace(/<\/li>\s*/gi, '\n');
    result = result.replace(/<li[^>]*>/gi, '• ');
    result = result.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const lbl = String(label).replace(/<[^>]+>/g, '').trim();
      if (lbl && lbl.length <= 20 && /[\u4e00-\u9fa5]/.test(lbl)) return lbl;
      return '';
    });
    result = result.replace(/<[^>]+>/g, '');
    Object.entries(HTML_ENTITIES).forEach(([entity, ch]) => {
      result = result.replaceAll(entity, ch);
    });
    return result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  /** 去掉链接、pageKey、路径参数等无法播报的内容 */
  function stripUrlsAndTechnical(text) {
    let t = String(text ?? '');
    t = t.replace(/https?:\/\/[^\s，,。；<>\"']+/gi, ' ');
    t = t.replace(/ftp:\/\/[^\s，,。；]+/gi, ' ');
    t = t.replace(/www\.[^\s，,。；]+/gi, ' ');
    t = t.replace(/(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|app)\/[^\s，,。；]*/gi, ' ');
    t = t.replace(/\b[a-z]{2,10}\/#\/[^\s，,。；]+/gi, ' ');
    t = t.replace(/\/(?:view|page|share|link|detail)[^\s，,。；]*/gi, ' ');
    t = t.replace(/(?:pageKey|page_key|shareKey|objectKey|token|language|utm_[a-z]+)=[A-Za-z0-9_-]+/gi, ' ');
    t = t.replace(/[?&][a-zA-Z_]+=[A-Za-z0-9_-]+/g, ' ');
    t = t.replace(/\b[a-f0-9]{20,}\b/gi, ' ');
    t = t.replace(/[\w.-]+\@[\w.-]+\.\w+/g, ' ');
    return t.replace(/\s{2,}/g, ' ').replace(/^[，,.\s:：]+/, '').trim();
  }

  /** #话题 → 口语「xxx话题」 */
  function oralizeHashtags(text) {
    return String(text ?? '')
      .replace(/#([\u4e00-\u9fa5A-Za-z0-9_]+)(?:\s*话题)?/g, '「$1」话题')
      .replace(/(?:务必带上|带上)\s*「([^」]+)」话题/g, '记得带上$1这个话题')
      .replace(/话题\s*话题/g, '话题');
  }

  /** 去掉文档式字段标签：奖励发放：、活动规则： */
  function stripDocFieldLabels(text) {
    return String(text ?? '')
      .replace(/(?:奖励发放|活动时间|活动规则|参与方式|注意事项|活动说明|内容简介|活动详情|领取方式|兑换方式)[：:]\s*/g, '')
      .replace(/^\s*[：:]\s*/g, '')
      .trim();
  }

  function hasTechnicalNoise(text) {
    const s = String(text ?? '');
    return /https?:|www\.|\.com|\.cn\/|pageKey=|\/#\//.test(s)
      || /#[A-Za-z0-9_\u4e00-\u9fa5]{2,}/.test(s)
      || /\b[a-z]{2,8}\/#\//.test(s);
  }

  function normalizePunctuation(text) {
    let result = text
      .replace(/\|[^|\n]{1,20}$/gm, '')
      .replace(/\|/g, '');
    // 保护小数，避免 1.5 → 1。5
    result = result.replace(/(\d)\.(\d)/g, '$1\x00DEC$2');
    result = result
      .replace(/,/g, '，')
      .replace(/\./g, '。')
      .replace(/:/g, '：')
      .replace(/;+/g, '；')
      .replace(/[ \t]+/g, ' ')
      .replace(/(\d)\x00DEC(\d)/g, '$1.$2')
      .trim();
    return result;
  }

  const ORDINAL_CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  function ordinalLabel(n) {
    if (n >= 1 && n <= 10) return `第${ORDINAL_CN[n]}`;
    if (n >= 11 && n <= 99) return `第${n}`;
    return `第${n}`;
  }

  /** 将文档式列表/章节标题转为可播报口语 */
  function oralizeDocumentStructure(text) {
    if (!text) return '';
    let result = stripHtml(text);
    result = stripUrlsAndTechnical(result);

    // 去掉 pipe 品类后缀（标准问/标题里常见）
    result = result.replace(/\s*\|\s*[^|\n]{1,30}$/gm, '');

    // 大类标题：1 产品类 / 2 服务类
    result = result.replace(/(?:^|\n|\s)\d{1,2}\s*[\u4e00-\u9fa5A-Za-z]{2,8}类\s*/g, ' ');

    // 中文编号章节：一、功能介绍 / （二）删除圈子动态
    result = result.replace(/(?:^|\s)[一二三四五六七八九十百千]+[、.)]\s*[\u4e00-\u9fa5]{2,16}\s*/g, ' ');
    result = result.replace(/(?:^|\s)[（(][一二三四五六七八九十\d]+[)）]\s*[\u4e00-\u9fa5]{2,20}\s*/g, ' ');

    // 无编号的章节小标题（含 h1-h6 残留文本）
    const sectionRe = new RegExp(
      `(?:^|[\\n\\s])(${CS_SECTION_HEADERS.join('|')})[：:：]?\\s*`,
      'g'
    );
    result = result.replace(sectionRe, ' ');
    result = result.replace(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi, ' $1 ');

    // 括号编号 (1) （1） → 第一，
    result = result.replace(/[（(]\s*(\d{1,2})\s*[）)]\s*/g, (_, num) => ` ${ordinalLabel(+num)}，`);

    // 编号列表 → 第一，第二，
    result = result.replace(/(?:^|\n|\s)(\d{1,2})[.．、)）]\s*(?:活动背景|活动规则|活动详情|活动内容|参与方式|适用条件|注意事项|温馨提示|申请条件|办理流程|所需材料)?[：:：]?\s*/g, (_, num) => {
      return ` ${ordinalLabel(+num)}，`;
    });

    // 无序列表符
    result = result.replace(/[•·●○◆▪\-—]\s+/g, '，');

    // 合并空白
    result = result.replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return result;
  }

  const CS_SECTION_HEADERS = [
    '活动背景', '活动规则', '活动详情', '活动内容', '参与方式', '适用条件', '注意事项',
    '温馨提示', '申请条件', '办理流程', '所需材料', '监督范围', '奖励说明', '投诉渠道',
    '活动说明', '活动介绍', '活动对象', '活动时间', '活动范围', '兑换说明', '使用说明',
    '服务说明', '权益说明', '保修说明', '退换说明', '常见问题', '问题解答', '答复如下',
    '功能介绍', '功能说明', '操作步骤', '操作说明', '使用方法', '删除方法', '发布方法'
  ];

  const CS_BOILERPLATE_PATTERNS = [
    /活动最终解释权归[^。；]*[。；]?/g,
    /最终解释权归[^。；]*[。；]?/g,
    /详情以[^。；]*(?:为准)[。；]?/g,
    /具体以[^。；]*(?:为准)[。；]?/g,
    /如有疑问[^。；]*[。；]?/g,
    /更多详情[^。；]*[。；]?/g,
    /非常抱歉给您带来(?:不便|困扰)[，,。!！\s]*/g,
    /根据(?:相关)?(?:法律|法规|规定|政策)[，,]\s*/g,
    /敬请(?:谅解|理解|留意|关注)[，,。!！\s]*/g,
    /祝您(?:生活|工作)?愉快[，,。!！\s]*/g,
    /如您(?:还)?(?:有|存在)(?:任何)?疑问[^。；]*[。；]?/g,
    /欢迎(?:您)?(?:随时)?(?:联系|咨询)(?:我们|客服)[^。；]*[。；]?/g,
    /我们将竭诚为您服务[^。；]*[。；]?/g,
    /工程师将评估[^。；]*[。；]?/g
  ];

  /** 去掉法务套话、冗余声明 */
  function stripBoilerplate(text) {
    let result = String(text ?? '');
    CS_BOILERPLATE_PATTERNS.forEach(re => { result = result.replace(re, ''); });
    return result.replace(/\s{2,}/g, ' ').trim();
  }

  const QUESTION_STOPWORDS = new Set([
    '什么', '怎么', '如何', '哪些', '是否', '能否', '可以', '多少', '为什么', '哪里', '哪个',
    '请问', '有没有', '能不能', '是不是', '啥时候', '啥时候', '相关', '内容', '问题', '情况'
  ]);

  function extractQuestionKeywords(question) {
    const q = String(question ?? '').replace(/[？?。！!，,]/g, '');
    const words = (q.match(/[\u4e00-\u9fa5]{2,6}/g) || [])
      .filter(w => !QUESTION_STOPWORDS.has(w));
    const extras = [];
    if (/删除|删掉|移除/.test(q)) extras.push('删除');
    if (/发布|发帖|发动态|发圈/.test(q)) extras.push('发布', '动态');
    if (/N币|n币|奖励|积分/.test(q)) extras.push('N币', '奖励', '积分');
    if (/圈子|社区|动态/.test(q)) extras.push('圈子', '动态');
    if (/功能|是什么|什么意思|干嘛|做什么/.test(q)) extras.push('功能', '介绍');
    if (/怎么|如何|怎样/.test(q)) extras.push('操作', '步骤');
    if (/绑定|解绑|注册|登录|注销|退出/.test(q)) extras.push('绑定', '注册', '登录', '注销');
    if (/\d+\s*号\s*报警|报警码|故障码/.test(q)) extras.push('报警', '故障', '报修', '工程师');
    return [...new Set([...words, ...extras])].slice(0, 10);
  }

  function isAlarmQuestion(question) {
    return /\d+\s*号\s*报警|报警码|故障代码|故障码/.test(String(question ?? ''));
  }

  function stripFaultDocLabels(text) {
    return String(text ?? '')
      .replace(/【问题表现】|【解决方案】|【处理建议】|【故障说明】/g, ' ')
      .replace(/(?:^|\s)(?:问题表现|解决方案|处理建议|故障说明)[：:]\s*/g, ' ')
      .replace(/\s+解决方案\s+/g, ' ')
      .replace(/仪表盘显示(?:第)?[\d一二三四五六七八九十]+号故障代码?[，,]?\s*/g, '')
      .replace(/无助力[，,。]?\s*/g, '')
      .replace(/该问题需要专业工程师处理[，,。]?\s*/g, '')
      .replace(/\b\d{10,}\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** 报警码答案里的 App 操作 → 短句（语音机器人一次能听清） */
  function compressAlarmAction(text) {
    const s = String(text ?? '');
    if (/一键报修/.test(s)) {
      return '建议打开九号出行App，在服务页或设备页点一键报修';
    }
    if (/附近门店|服务店|查.*门店|支持维修/.test(s)) {
      return '您可以在九号出行App服务页或设备页查附近维修门店';
    }
    return oralizeAppNavigation(oralizeFormalPhrases(s))
      .replace(/^请/, '')
      .replace(/工程师将评估[^，,。；]*/g, '')
      .replace(/填写[^，,。；]{4,20}故障信息/g, '填写故障信息')
      .trim();
  }

  function isAlreadyVoiceifiedAlarm(text) {
    const s = String(text ?? '').trim();
    return /^建议打开九号出行App/.test(s)
      || /^您可以在九号出行App服务页/.test(s)
      || /^需要工程师处理，建议您在九号出行App/.test(s);
  }

  /** 故障/报警码 FAQ → 语音机器人可执行话术 */
  function voiceifyAlarmAnswer(question, answer, maxLen) {
    const raw = String(answer ?? '');
    if (isAlreadyVoiceifiedAlarm(raw)) {
      return enforceTurnLength(raw, maxLen, 0);
    }
    let t = stripFaultDocLabels(stripUrlsAndTechnical(stripHtml(raw)));
    t = stripFormalOpenings(stripBoilerplate(t));
    t = stripDocFieldLabels(t);

    const actionClauses = splitIntoClauses(t)
      .filter(s => /打开|点|找到|填写|预约|报修|门店|服务页|设备页/.test(s))
      .filter(s => !/^无助力|一般是|仪表盘/.test(s.trim()))
      .sort((a, b) => {
        const score = (s) => (/一键报修/.test(s) ? 12 : 0) + (/打开/.test(s) ? 6 : 0) + (/服务页|设备页/.test(s) ? 4 : 0) - s.length * 0.01;
        return score(b) - score(a);
      });

    const parts = [];

    if (actionClauses.length) {
      parts.push(compressAlarmAction(actionClauses[0]));
    } else if (/一键报修/.test(t)) {
      parts.push('建议打开九号出行App，在服务页或设备页点一键报修');
    } else if (/专业工程师|工程师处理|工程师/.test(raw)) {
      parts.push('需要工程师处理，建议您在九号出行App服务页点一键报修');
    } else if (/附近门店|服务店|维修/.test(t)) {
      parts.push('您可以在九号出行App服务页或设备页查附近维修门店');
    }

    if (!parts.length) {
      t = t.replace(/仪表盘显示[^，,。；]{4,24}[，,]?/g, '');
      return enforceTurnLength(oralizeFormalPhrases(oralizeAppNavigation(t)), maxLen, 0);
    }

    let result = parts.slice(0, 2).join('，');
    if (!/[。！？?]$/.test(result)) result += '。';
    return enforceTurnLength(result, maxLen, 0);
  }

  function hasDocumentStructure(text) {
    const s = String(text ?? '');
    return /[一二三四五六七八九十]+[、.)]\s*[\u4e00-\u9fa5]|[（(][一二三四五六七八九十\d]+[)）]\s*[\u4e00-\u9fa5]/.test(s);
  }

  /** 按「一、」「（二）」等切分文档段落 */
  function splitDocumentSections(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return [];

    const normalized = raw
      .replace(/([。；！!?])([（(][一二三四五六七八九十\d]+[)）])/g, '$1 $2')
      .replace(/([。；！!?])([一二三四五六七八九十]+[、.)])/g, '$1 $2');

    const markerRe = /(?:^|\s)(?:([一二三四五六七八九十]+)[、.)]\s*([\u4e00-\u9fa5]{2,20})|[（(]([一二三四五六七八九十\d]+)[)）]\s*([\u4e00-\u9fa5]{2,24}))/g;
    const markers = [];
    let m;
    while ((m = markerRe.exec(normalized)) !== null) {
      markers.push({
        index: m.index,
        len: m[0].length,
        title: (m[2] || m[4] || '').trim()
      });
    }
    if (!markers.length) return [{ title: '', body: raw }];

    const sections = [];
    for (let i = 0; i < markers.length; i++) {
      const bodyStart = markers[i].index + markers[i].len;
      const bodyEnd = i + 1 < markers.length ? markers[i + 1].index : normalized.length;
      const body = normalized.slice(bodyStart, bodyEnd).trim();
      if (body) sections.push({ title: markers[i].title, body });
    }
    return sections.length ? sections : [{ title: '', body: raw }];
  }

  function scoreSectionForQuestion(section, keywords, question) {
    let score = 0;
    const q = String(question ?? '');
    const title = section.title || '';
    const body = section.body || '';
    keywords.forEach(kw => {
      if (title.includes(kw)) score += 25;
      if (body.includes(kw)) score += 12;
    });
    if (/怎么|如何|怎样|在哪|哪里|能不能|可以/.test(q)) {
      if (/删除|发布|设置|绑定|注销|开通|关闭|修改|更换|取消|退出/.test(title)) score += 15;
      if (/介绍|背景|说明|什么是|功能介绍|奖励/.test(title) && !/删除|发布|设置|操作/.test(title)) score -= 12;
    }
    if (/是什么|什么意思|什么是|干嘛|做什么/.test(q)) {
      if (/介绍|功能|说明|什么是/.test(title)) score += 15;
      if (/删除|操作步骤/.test(title)) score -= 5;
    }
    if (/删除/.test(q) && /删除/.test(title + body)) score += 20;
    if (/删除/.test(q) && /介绍|奖励|背景/.test(title) && !/删除/.test(title)) score -= 20;
    if (/发布/.test(q) && /发布/.test(title + body)) score += 20;
    if (/N币|奖励|积分/.test(q) && /N币|奖励|积分/.test(title + body)) score += 15;
    if (/步骤|操作|点击|打开|App|APP/.test(body)) score += 4;
    return score;
  }

  function pickSectionForQuestion(text, question) {
    const sections = splitDocumentSections(text);
    if (sections.length <= 1) return text;
    const keywords = extractQuestionKeywords(question);
    const ranked = [...sections].sort((a, b) =>
      scoreSectionForQuestion(b, keywords, question) - scoreSectionForQuestion(a, keywords, question));
    const best = ranked[0];
    if (best && scoreSectionForQuestion(best, keywords, question) > 0) {
      return best.body;
    }
    return ranked.find(s => !/介绍|背景|说明/.test(s.title))?.body || sections[sections.length - 1].body;
  }

  function stripSectionHeaders(text) {
    return String(text ?? '')
      .replace(/(?:^|\s)[一二三四五六七八九十百千]+[、.)]\s*[\u4e00-\u9fa5]{2,20}\s*/g, ' ')
      .replace(/(?:^|\s)[（(][一二三四五六七八九十\d]+[)）]\s*[\u4e00-\u9fa5]{2,24}\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** App 内路径与操作步骤 → 可听懂的口语 */
  function oralizeAppNavigation(text) {
    let t = String(text ?? '');
    t = t.replace(/【([^】]+)】/g, '$1');
    t = t.replace(/([\u4e00-\u9fa5A-Za-z0-9]+)\s*[-—/\\|]\s*([\u4e00-\u9fa5A-Za-z0-9]+)/g, '$1，再点$2');
    t = t.replace(/依次点击|依次点/g, '按顺序点');
    t = t.replace(/联系下方/g, '点下方');
    t = t.replace(/找到对应/g, '找到那条');
    t = t.replace(/找到该/g, '找到这条');
    t = t.replace(/点击下方(?:更多|转发|菜单|操作)?(?:按钮|图标)?/g, '点下方按钮');
    t = t.replace(/选择删除即可/g, '点删除就行');
    t = t.replace(/选择([^，,。；]{1,6})即可/g, '点$1就行');
    t = t.replace(/即可[。.]?$/g, '就行');
    t = t.replace(/打开九号出行\s*App/gi, '打开九号出行App');
    t = t.replace(/九号出行\s*App/gi, '九号出行App');
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  /** 压缩 App 操作步骤，保留关键 2-3 步 */
  function compressAppSteps(text, maxLen) {
    let t = String(text ?? '').trim();
    if (!t || t.length <= maxLen) return t;
    if (!/打开|点|进入|找到|选择|删除|发布/.test(t)) return t;

    const openMatch = t.match(/打开[^，,。；]{2,24}/);
    const pathMatch = t.match(/点[^，,。；]{1,8}(?:，再点[^，,。；]{1,8})?/);
    const actionMatch = t.match(/(?:找到[^，,。；]{2,16}[，,])?(?:点[^，,。；]{1,8}就行|选择[^，,。；]{1,8}就行|删除就行)/);

    const parts = [];
    if (openMatch) parts.push(openMatch[0]);
    if (pathMatch) parts.push(pathMatch[0]);
    if (actionMatch) parts.push(actionMatch[0].replace(/选择/, '点'));
    if (parts.length >= 2) {
      const compressed = parts.join('，') + '。';
      if (compressed.length <= maxLen) return compressed;
    }
    return t;
  }

  /** 最终润色：一条答案只讲一件事，像客服在电话里说 */
  function polishVoiceAnswer(text, question, maxLen) {
    if (isAlarmQuestion(question)) {
      return voiceifyAlarmAnswer(question, text, maxLen);
    }
    let t = pickSectionForQuestion(text, question);
    t = stripUrlsAndTechnical(t);
    t = stripSectionHeaders(t);
    t = stripDocFieldLabels(t);
    t = stripFormalOpenings(stripBoilerplate(t));
    t = oralizeHashtags(t);
    t = oralizeAppNavigation(t);
    t = oralizeFormalPhrases(t);
    t = compressAppSteps(t, maxLen);
    t = t.replace(/功能介绍\s*/g, '');
    t = t.replace(/，{2,}/g, '，').replace(/^[，,.\s:：]+/, '');
    t = stripUrlsAndTechnical(t);
    return enforceTurnLength(t, maxLen, 0);
  }

  function splitIntoClauses(text) {
    const pre = stripSectionHeaders(String(text ?? ''));
    return pre
      .split(/(?=[一二三四五六七八九十]+[、.)]|[（(][一二三四五六七八九十\d]+[)）]|第[一二三四五六七八九十\d]+，)|[。；！？\n]+/)
      .map(s => s.trim()
        .replace(/^第[一二三四五六七八九十\d]+，/, '')
        .replace(/^[•·●○◆▪\-—]\s*/, ''))
      .filter(s => s.length > 4 && !/^[\d\s类]+$/.test(s) && !CS_SECTION_HEADERS.includes(s.replace(/[：:。，,\s]/g, '')));
  }

  function scoreClauseForQuestion(clause, questionKeywords) {
    let score = 0;
    const s = clause.trim();
    if (s.length < 6 || s.length > 200) score -= 3;
    if (/感谢|尊敬|亲爱的|如下|上述|详见|敬请|抱歉给您|pageKey|https?:|\/#\//.test(s)) score -= 12;
    if (/可以|能够|支持|享受|获得|领取|兑换|参与|办理|申请|保修|退换|到店|鼓励|监督|反馈/.test(s)) score += 6;
    if (/一般|通常|建议|需要|必须|仅限|每人|每次|有效期|截止/.test(s)) score += 3;
    questionKeywords.forEach(kw => {
      if (s.includes(kw)) score += 12;
      else if (kw.length >= 3 && s.includes(kw.slice(0, 2))) score += 4;
    });
    if (/背景|旨在|目的|意义/.test(s) && !/参与|获得|可以|申请|办理/.test(s)) score -= 6;
    if (/打开|点|报修|门店|服务页|工程师|预约|填写/.test(s)) score += 8;
    if (/仪表盘显示|解决方案|问题表现|故障代码/.test(s)) score -= 10;
    return score;
  }

  function isOverlyFormal(text) {
    const s = String(text ?? '');
    if (!s) return false;
    const formalHits = (s.match(/感谢|尊敬|亲爱的|如下|上述|详见|敬请|根据.*规定|请参阅|非常抱歉/g) || []).length;
    return formalHits >= 2 || (formalHits >= 1 && s.length > 60);
  }

  /** 长文档压缩为可播报要点（内置规则，非 LLM） */
  function condenseForVoice(text, maxLen, question) {
    let result = stripBoilerplate(stripFormalOpenings(text));
    const ordinals = (result.match(/第[一二三四五六七八九十\d]+，/g) || []).length;
    const keywords = extractQuestionKeywords(question);
    const clauses = splitIntoClauses(result);

    if (result.length <= maxLen && ordinals <= 1 && clauses.length <= 2) {
      return oralizeFormalPhrases(result);
    }

    const ranked = [...clauses].sort((a, b) =>
      scoreClauseForQuestion(b, keywords) - scoreClauseForQuestion(a, keywords) || a.length - b.length
    );

    const seen = new Set();
    const picked = [];
    let total = 0;
    for (const s of ranked) {
      const cleaned = oralizeFormalPhrases(stripFormalOpenings(s));
      if (!cleaned || cleaned.length < 4) continue;
      const key = cleaned.slice(0, 10);
      if (seen.has(key)) continue;
      if (picked.length >= 1) break;
      if (total + cleaned.length + 1 > maxLen - 4) continue;
      seen.add(key);
      picked.push(cleaned);
      total += cleaned.length + 1;
    }

    if (picked.length) return picked.join('，') + '。';
    return truncateAtSentence(oralizeFormalPhrases(result), maxLen);
  }

  /**
   * 深度内置口语化：针对 HTML/长客服话术，按问题抽取要点并改写
   * 不依赖大模型，但比简单截断质量高得多
   */
  function deepVoiceifyAnswer(question, rawAnswer, maxLen) {
    let text = oralizeDocumentStructure(rawAnswer || '');
    text = pickSectionForQuestion(text, question);
    text = stripFormalOpenings(stripBoilerplate(text));
    text = normalizePunctuation(text);
    text = stripCategoryTagsFromAnswer(text);

    const plainLen = text.replace(/\s/g, '').length;
    if (!text) return '';

    let condensed = condenseForVoice(text, maxLen, question);
    condensed = polishVoiceAnswer(condensed || text, question, maxLen);

    if (condensed && !isOverlyFormal(condensed) && !hasDocumentStructure(condensed)) {
      return condensed;
    }

    const keywords = extractQuestionKeywords(question);
    const best = splitIntoClauses(text)
      .sort((a, b) => scoreClauseForQuestion(b, keywords) - scoreClauseForQuestion(a, keywords))[0];
    if (best) {
      condensed = polishVoiceAnswer(best, question, maxLen);
      if (condensed) return condensed;
    }

    return polishVoiceAnswer(text, question, maxLen);
  }

  /** 硬控单轮字数（含「您好，」前缀预留） */
  function enforceTurnLength(turn, maxLen, reservePrefix) {
    const limit = Math.max(20, maxLen - (reservePrefix || 0));
    if (!turn || turn.length <= limit) return turn;
    return truncateAtSentence(turn, limit);
  }

  /** 去掉客服套话开头，避免「您好，您好，感谢您…」 */
  function stripFormalOpenings(text) {
    let result = String(text ?? '').trim();
    for (let i = 0; i < 3; i++) {
      const next = result
        .replace(/^您好[，,!\s]*/u, '')
        .replace(/^你好[，,!\s]*/u, '')
        .replace(/^(感谢|谢谢)(您)?(的)?(支持|关注|使用|来信|反馈|咨询)[，,。!！\s]*/u, '')
        .replace(/^尊敬的用户[，,]\s*/u, '')
        .replace(/^亲爱的用户[，,]\s*/u, '')
        .replace(/^[！!]+$/u, '')
        .trim();
      if (next === result) break;
      result = next;
    }
    return result;
  }

  /** 书面语 → 播报口语（Layer1 确定性改写） */
  function oralizeFormalPhrases(text) {
    return (text || '')
      .replace(/该商品|该产品/g, '这款产品')
      .replace(/上述|如下所述|具体如下/g, '')
      .replace(/详见/g, '可以了解')
      .replace(/查看/g, '了解')
      .replace(/扫码/g, '扫一扫')
      .replace(/登录/g, '进入')
      .replace(/官方网站|官方平台/g, '官网')
      .replace(/授权代理商\/门店/g, '授权门店')
      .replace(/温馨提示[：:，,]?/g, '')
      .replace(/请注意[：:，,]?/g, '')
      .replace(/也就是说[，,]?/g, '')
      .replace(/尊敬的用户[，,]?/g, '')
      .replace(/亲爱的用户[，,]?/g, '')
      .replace(/自主发布/g, '自己发')
      .replace(/优质内容/g, '好的内容')
      .replace(/获取平台/g, '拿到')
      .replace(/[（(]详见[^）)]*[）)]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const UNITS = ['', '十', '百', '千'];

  function intToChinese(num) {
    if (num === 0) return '零';
    if (num < 0 || num > 99999) return String(num);
    if (num < 10) return DIGITS[num];
    if (num < 20) return num === 10 ? '十' : '十' + DIGITS[num % 10];
    let result = '';
    const str = String(num);
    for (let i = 0; i < str.length; i++) {
      const n = +str[i];
      const unit = UNITS[str.length - i - 1];
      if (n === 0) {
        if (!result.endsWith('零') && i < str.length - 1) result += '零';
      } else {
        result += DIGITS[n] + unit;
      }
    }
    return result.replace(/零+$/, '').replace(/零+/g, '零');
  }

  function oralizeNumbers(text) {
    return text
      .replace(/(\d+(?:\.\d+)?)\s*元/g, (_, n) => intToChinese(Math.round(+n)) + '元')
      .replace(/(\d+(?:\.\d+)?)\s*kg/gi, (_, n) => intToChinese(Math.round(+n)) + '公斤')
      .replace(/(\d+(?:\.\d+)?)\s*km/gi, (_, n) => intToChinese(Math.round(+n)) + '公里')
      .replace(/(\d+(?:\.\d+)?)\s*[wW]/g, (_, n) => intToChinese(Math.round(+n)) + '瓦')
      .replace(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g, (_, y, m, d) =>
        `${intToChinese(+y)}年${intToChinese(+m)}月${intToChinese(+d)}日`)
      .replace(/\b(\d{2,5})\b/g, (match) => {
        const n = +match;
        return Number.isFinite(n) && n <= 99999 ? intToChinese(n) : match;
      });
  }

  function splitMultiEntity(text) {
    const parts = text.split(/(?=[^。；]{1,30}[：:])/).filter(p => p.trim());
    if (parts.length <= 1) return [text];
    return parts.map(p => p.trim()).filter(Boolean);
  }

  function truncateAtSentence(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    const slice = text.slice(0, maxLen);
    const breaks = ['。', '；', '，', '、', ' '];
    let best = -1;
    breaks.forEach(ch => {
      const idx = slice.lastIndexOf(ch);
      if (idx > best) best = idx;
    });
    return best > maxLen * 0.4 ? slice.slice(0, best + 1) : slice;
  }

  function splitAnswerTurns(text, maxLen, maxTurns) {
    const turns = [];
    let remaining = text.trim();
    while (remaining && turns.length < maxTurns) {
      if (remaining.length <= maxLen) {
        turns.push(remaining);
        break;
      }
      const chunk = truncateAtSentence(remaining, maxLen);
      turns.push(chunk);
      remaining = remaining.slice(chunk.length).trim();
    }
    return turns.length ? turns : [''];
  }

  function detectSensitive(text) {
    return SENSITIVE_KEYWORDS.some(kw => text.includes(kw));
  }

  /** 是否为纯分类标签行，如 【产品咨询】或 【产品咨询】。 */
  function isCategoryTagOnly(text) {
    return /^【[^】]{1,20}】[。．.]?\s*$/.test((text || '').trim());
  }

  /** 剥离答案开头的分类标签，保留真实播报内容 */
  function stripCategoryTagsFromAnswer(text) {
    if (!text) return '';
    let result = text.trim();
    // 逐行去掉开头的纯标签行
    const lines = result.split('\n');
    while (lines.length && isCategoryTagOnly(lines[0])) {
      lines.shift();
    }
    result = lines.join('\n').trim();
    // 去掉行内开头的标签前缀
    result = result.replace(/^【[^】]{1,20}】[。．.]?\s*/g, '').trim();
    return result;
  }

  function extractCategoryTag(text) {
    const m = (text || '').trim().match(/^【([^】]+)】/);
    return m ? m[1] : null;
  }

  const CATEGORY_SLUG_MAP = {
    activity: '营销活动', supervisor: '门店监督', product: '产品咨询', member: '会员服务',
    ncoin: 'N币', app: 'APP功能', community: '社区圈子', range: '产品参数',
    standard: '标准版', colors: '外观配色', service: '售后服务', warranty: '保修政策',
    faq: '常见问题', support: '售后支持', sales: '售前咨询', marketing: '营销活动',
    ebike: 'E-bike', 'e-bike': 'E-bike', electric: '电动车', vehicle: '整车',
    battery: '电池', charger: '充电器', firmware: '固件升级', software: '软件功能'
  };

  function isTechnicalPathValue(value) {
    const s = String(value ?? '').trim();
    if (!s) return true;
    if (/^https?:\/\//i.test(s)) return true;
    if (/^[a-f0-9-]{32,}$/i.test(s)) return true;
    if (/\.(jpg|jpeg|png|gif|pdf|doc|xlsx|csv|zip)$/i.test(s)) return true;
    if (/^\/[a-z0-9_\-/\\]+$/i.test(s)) return true;
    if (/^[a-z0-9_\-]+(\/[a-z0-9_\-]+)+$/i.test(s) && !/[\u4e00-\u9fa5]/.test(s)) return true;
    return false;
  }

  function isReadableCategoryValue(value) {
    const s = String(value ?? '').trim();
    if (!s || isTechnicalPathValue(s)) return false;
    if (/^[\d\s./\\_-]+$/.test(s)) return false;
    if (/[\u4e00-\u9fa5]/.test(s)) return s.length <= 24;
    return /^[A-Za-z][A-Za-z0-9\-]{0,14}$/.test(s);
  }

  function translateCategorySegment(part) {
    const raw = String(part ?? '').trim();
    if (!raw) return '';
    if (/[\u4e00-\u9fa5]/.test(raw)) return raw.replace(/^\*+/, '');
    const key = raw.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    return CATEGORY_SLUG_MAP[key] || CATEGORY_SLUG_MAP[raw.toLowerCase()] || '';
  }

  function extractCategoryFromQuestion(question) {
    const q = String(question ?? '').trim();
    const pipe = q.match(/\|\s*([^|？?]{1,20})$/);
    if (pipe) return pipe[1].trim();
    const tags = [
      ['门店监督|监督官', '门店监督'],
      ['N币|n币', 'N币'],
      ['APP|app|圈子', 'APP功能'],
      ['续航|里程', '产品参数'],
      ['颜色|配色|外观', '外观配色'],
      ['保修|质保', '售后服务'],
      ['活动', '营销活动'],
      ['E-bike|e-bike', 'E-bike'],
      ['九号电动|电动车', '九号电动']
    ];
    for (const [pattern, label] of tags) {
      if (new RegExp(pattern, 'i').test(q)) return label;
    }
    return '';
  }

  function normalizeCategorySegments(path) {
    const parts = String(path ?? '')
      .split(/[/>\\|]/)
      .map(p => p.trim())
      .filter(Boolean);
    const translated = parts.map(p => translateCategorySegment(p) || (/[\u4e00-\u9fa5]/.test(p) ? p : '')).filter(Boolean);
    return [...new Set(translated)];
  }

  function buildReadableCategory(rawCategory, question, companyName) {
    const fromCells = normalizeCategorySegments(rawCategory);
    const fromQuestion = extractCategoryFromQuestion(question);
    const parts = [];

    if (fromCells.length && fromCells.some(p => /[\u4e00-\u9fa5]/.test(p))) {
      parts.push(...fromCells.filter(p => /[\u4e00-\u9fa5]/.test(p)));
    } else if (fromCells.length) {
      parts.push(...fromCells);
    }

    if (fromQuestion && !parts.includes(fromQuestion)) {
      parts.push(fromQuestion);
    }

    if (!parts.length && companyName) {
      parts.push(companyName.replace(/公司|品牌/g, '').trim() || companyName, '通用');
    } else if (!parts.length) {
      parts.push('通用');
    }

    return parts.slice(0, 3).join('/');
  }

  function ensureCategoryPath(path, prefix, depth) {
    const normalized = buildReadableCategory(path, '', '');
    let result = normalized.replace(/\s+/g, '');
    if (prefix && !result.startsWith(prefix.replace(/\/$/, ''))) {
      result = prefix.replace(/\/$/, '') + '/' + result;
    }
    if (!result.includes('/')) {
      result = result + '/默认';
    }
    const parts = result.split('/').filter(Boolean);
    return parts.slice(0, Math.max(depth, 2)).join('/');
  }

  function preprocessText(rawText, config) {
    // 提取阶段保留 HTML/原始结构，语音化阶段再清理
    return String(rawText ?? '').replace(/\r/g, '').trim();
  }

  function plainTextLength(text) {
    return stripHtml(String(text ?? '')).replace(/\s/g, '').length;
  }

  function applyLayer1ToEntry(entry, config) {
    const maxLen = config.maxAnswerLength || 120;
    const maxTurns = config.maxAnswerTurns || 5;
    const question = entry.question || entry.standardQuestion || '';
    const rawAnswer = entry.answer || '';
    const needsDeep = entry.hasHtml || plainTextLength(rawAnswer) > maxLen * 1.2
      || isOverlyFormal(stripHtml(rawAnswer)) || hasDocumentStructure(stripHtml(rawAnswer))
      || hasTechnicalNoise(stripHtml(rawAnswer));

    let answer;
    if (needsDeep) {
      answer = deepVoiceifyAnswer(question, rawAnswer, maxLen);
    } else {
      answer = oralizeDocumentStructure(rawAnswer);
      answer = stripFormalOpenings(answer);
      answer = normalizePunctuation(answer);
      answer = stripCategoryTagsFromAnswer(answer);
      answer = stripBoilerplate(answer);
      answer = polishVoiceAnswer(answer, question, maxLen);
    }
    answer = oralizeNumbers(answer);

    let standardQuestion = normalizePunctuation(entry.question || entry.standardQuestion || '');
    standardQuestion = standardQuestion.replace(/\s*\|\s*[^|]{1,30}$/g, '').trim();
    standardQuestion = oralizeFormalPhrases(standardQuestion).slice(0, 200);
    const intentTag = entry.intentTag || extractCategoryTag(entry.answer || entry.summary || '');

    if (!answer || isCategoryTagOnly(answer)) {
      const fallback = stripCategoryTagsFromAnswer(stripHtml(entry.sourceExcerpt || ''));
      if (fallback && !isCategoryTagOnly(fallback)) answer = fallback;
    }

    let answerTurns = splitAnswerTurns(answer, maxLen, maxTurns);
    answerTurns = answerTurns.map(turn => {
      let t = polishVoiceAnswer(stripFormalOpenings(turn), question, maxLen);
      const ordinals = (t.match(/第[一二三四五六七八九十\d]+，/g) || []).length;
      if (t.length > maxLen || ordinals > 1 || hasDocumentStructure(t) || isOverlyFormal(t)) {
        t = condenseForVoice(t, maxLen, question);
        t = polishVoiceAnswer(t, question, maxLen);
      }
      return t;
    }).filter(t => t && t.length > 2);
    const needsHuman = detectSensitive(standardQuestion + answer);

    let summary = entry.summary || '';
    if (!summary || isCategoryTagOnly(summary)) {
      summary = truncateAtSentence(answerTurns[0] || '', 50);
    }
    summary = stripCategoryTagsFromAnswer(summary).slice(0, 50);

    const keywords = [...(entry.keywords || [])];
    if (intentTag && !keywords.includes(intentTag)) keywords.unshift(intentTag);

    return {
      categoryPath: ensureCategoryPath(entry.categoryPath || entry.category, config.categoryPrefix, config.categoryDepth || 2),
      standardQuestion,
      summary,
      answerTurns,
      keywords,
      needsHuman,
      transferReason: needsHuman ? '含敏感/合规关键词，建议人工审核' : null,
      sourceExcerpt: (entry.sourceExcerpt || answer).slice(0, 200),
      conflict: false
    };
  }

  function chunkText(text, chunkSize = 150 * 1024) {
    if (text.length <= chunkSize) return [text];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);
      if (end < text.length) {
        const breakAt = text.lastIndexOf('\n\n', end);
        if (breakAt > start + chunkSize * 0.5) end = breakAt;
      }
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  }

  global.KVTextRules = {
    stripHtml,
    stripUrlsAndTechnical,
    oralizeHashtags,
    stripDocFieldLabels,
    hasTechnicalNoise,
    isAlarmQuestion,
    voiceifyAlarmAnswer,
    stripFaultDocLabels,
    normalizePunctuation,
    oralizeNumbers,
    oralizeDocumentStructure,
    stripFormalOpenings,
    oralizeFormalPhrases,
    stripBoilerplate,
    condenseForVoice,
    deepVoiceifyAnswer,
    polishVoiceAnswer,
    oralizeAppNavigation,
    pickSectionForQuestion,
    splitDocumentSections,
    hasDocumentStructure,
    stripSectionHeaders,
    extractQuestionKeywords,
    splitIntoClauses,
    isOverlyFormal,
    plainTextLength,
    enforceTurnLength,
    splitMultiEntity,
    truncateAtSentence,
    splitAnswerTurns,
    detectSensitive,
    ensureCategoryPath,
    isCategoryTagOnly,
    stripCategoryTagsFromAnswer,
    extractCategoryTag,
    isTechnicalPathValue,
    isReadableCategoryValue,
    extractCategoryFromQuestion,
    buildReadableCategory,
    normalizeCategorySegments,
    translateCategorySegment,
    preprocessText,
    applyLayer1ToEntry,
    chunkText,
    SENSITIVE_KEYWORDS
  };
})(window);

/* --- localKnowledgeEngine.js --- */
/** 内置规则引擎 — 本地拆解 / 语音化 / 去重 / 相似问（优先于 LLM） */
(function (global) {
  if (!global.KVTextRules) {
    console.error('[KVLocalEngine] KVTextRules 未加载');
    global.KVLocalEngine = {};
    return;
  }
  const R = global.KVTextRules;

  function inferCategory(text, config) {
    const m = text.match(/【([^】]+)】/);
    if (m) return m[1].replace(/\|.*$/, '').trim();
    if (config.docType === 'param_faq') return '产品参数';
    if (config.docType === 'activity') return '营销活动';
    if (config.docType === 'service') return '售后服务';
    return config.companyName ? `${config.companyName}/通用` : '通用知识';
  }

  function extractKeywords(text) {
    const words = (text || '').match(/[\u4e00-\u9fa5A-Za-z]{2,8}/g) || [];
    return [...new Set(words)].slice(0, 5);
  }

  /** Phase 1 本地拆解 */
  function localExtractFindings(rawText, config) {
    const text = R.preprocessText(rawText, config);
    const findings = [];
    const defaultCat = inferCategory(text, config);

    // 模式 1：问： / 答： 成对（不在答案内的编号列表处截断）
    const qaBlockRe = /(?:^|\n)\s*(?:【([^】]+)】\s*\n)?\s*问[：:]\s*(.+?)\s*\n\s*答[：:]\s*([\s\S]*?)(?=\n\s*(?:【[^】]+】\s*\n\s*)?问[：:]|\n{2,}【|$)/g;
    let m;
    while ((m = qaBlockRe.exec(text)) !== null) {
      const cat = (m[1] || defaultCat).replace(/\|.*$/, '').trim();
      const q = m[2].trim();
      const a = m[3].trim();
      if (q && a) pushFinding(findings, cat, q, a, config);
    }
    if (findings.length) return expandFindings(findings, config);

    // 模式 2：编号问答 1. xxx？ 答案...
    const lines = text.split('\n');
    let currentCat = defaultCat;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const catMatch = line.match(/^【([^】]+)】$/);
      if (catMatch) {
        currentCat = catMatch[1].replace(/\|.*$/, '').trim();
        i++;
        continue;
      }

      const numQ = line.match(/^(\d+)[.、.)]\s*(.+[？?].*?)$/);
      if (numQ) {
        const question = numQ[2].trim();
        const answerParts = [];
        i++;
        while (i < lines.length) {
          const next = lines[i].trim();
          if (!next) { i++; continue; }
          if (/^(\d+)[.、.)]/.test(next) || /^问[：:]/.test(next)) break;
          if (R.isCategoryTagOnly(next)) { i++; continue; }
          answerParts.push(next);
          i++;
        }
        const answer = answerParts.join('').trim() || question;
        if (question) pushFinding(findings, currentCat, question, answer, config);
        continue;
      }

      // 模式 3：单行问句（以？结尾）+ 下一行起为答案
      if (/[？?]$/.test(line) && line.length < 120) {
        const answerParts = [];
        i++;
        while (i < lines.length) {
          const next = lines[i].trim();
          if (!next) { i++; continue; }
          if (/^【/.test(next) && R.isCategoryTagOnly(next)) { i++; continue; }
          if (/[？?]$/.test(next) && next.length < 80 && answerParts.length > 0) break;
          if (/^(\d+)[.、.)]/.test(next)) break;
          answerParts.push(next);
          i++;
          if (answerParts.join('').length > 2000) break;
        }
        if (answerParts.length) pushFinding(findings, currentCat, line, answerParts.join(''), config);
        continue;
      }
      i++;
    }

    if (findings.length) return expandFindings(findings, config);

    // 模式 4：按段落拆分（每段首句为问，其余为答）
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
    paragraphs.forEach(p => {
      const parts = p.split('\n').filter(Boolean);
      if (parts.length >= 2) {
        pushFinding(findings, defaultCat, parts[0], parts.slice(1).join(''), config);
      } else if (parts.length === 1 && parts[0].length > 20) {
        pushFinding(findings, defaultCat, '请问相关内容是什么？', parts[0], config);
      }
    });

    return expandFindings(findings, config);
  }

  function pushFinding(list, category, question, answer, config) {
    const q = question.trim();
    const rawAnswer = answer.trim();
    let a = R.stripCategoryTagsFromAnswer(rawAnswer);
    const intentTag = R.extractCategoryTag(a) || R.extractCategoryTag(q);
    if (!q || !a || q.length < 2 || a.length < 1) return;
    if (R.isCategoryTagOnly(R.stripHtml(a))) return;
    if (/^第\s*\d+\s*页$/.test(q) || /^目录$/.test(q)) return;

    const plainLen = R.plainTextLength(rawAnswer);
    const hasHtml = /<[^>]+>/.test(rawAnswer);

    list.push({
      category,
      question: ensureQuestion(q),
      answer: rawAnswer,
      intentTag,
      keywords: extractKeywords(q + R.stripHtml(rawAnswer)),
      sourceExcerpt: R.stripHtml(rawAnswer).slice(0, 200),
      isComplex: R.detectSensitive(q + R.stripHtml(rawAnswer)) || plainLen > 600 || hasHtml,
      rawAnswerLength: plainLen,
      hasHtml
    });
  }

  function ensureQuestion(text) {
    const t = text.replace(/[？?。]+$/g, '').trim();
    return t.endsWith('？') || t.endsWith('?') ? t : t + '？';
  }

  function expandFindings(findings, config) {
    const expanded = [];
    findings.forEach(f => {
      const entities = R.splitMultiEntity(f.answer);
      if (entities.length > 1 && entities.every(e => e.includes('：') || e.includes(':'))) {
        entities.forEach(ent => {
          const [label, ...rest] = ent.split(/[：:]/);
          expanded.push({
            ...f,
            question: ensureQuestion(`${label.trim()}${f.question.replace(/^.+[？?]/, '')}` || label),
            answer: rest.join('：').trim() || ent,
            keywords: extractKeywords(label + rest.join(''))
          });
        });
      } else {
        expanded.push(f);
      }
    });
    return expanded.map(f => ({
      categoryPath: R.ensureCategoryPath(f.category, config.categoryPrefix, config.categoryDepth || 2),
      category: f.category,
      question: f.question,
      answer: f.answer,
      keywords: f.keywords,
      sourceExcerpt: f.sourceExcerpt,
      isComplex: f.isComplex,
      rawAnswerLength: f.rawAnswerLength || R.plainTextLength(f.answer),
      hasHtml: f.hasHtml || /<[^>]+>/.test(f.answer || '')
    }));
  }

  /** Phase 2 内置语音化 — Layer1 深度口语化 + 轻量语气模板 */
  function localVoiceifyFindings(findings, config) {
    return findings.map(f => {
      const entry = R.applyLayer1ToEntry({
        categoryPath: f.categoryPath,
        question: f.question,
        answer: f.answer,
        keywords: f.keywords,
        sourceExcerpt: f.sourceExcerpt,
        hasHtml: f.hasHtml,
        rawAnswerLength: f.rawAnswerLength
      }, config);

      entry.answerTurns = entry.answerTurns.map((turn, i) => oralizeAnswerTone(turn, i === 0, config, f.question));
      entry._voiceQuality = scoreVoiceQuality(entry, f, config);
      if (!entry.standardQuestion.match(/[？?]$/)) {
        entry.standardQuestion = ensureQuestion(entry.standardQuestion);
      }
      return entry;
    });
  }

  function scoreVoiceQuality(entry, finding, config) {
    const turn = (entry.answerTurns || [])[0] || '';
    let score = 0;
    if (R.isOverlyFormal(turn)) score += 30;
    if ((finding.rawAnswerLength || 0) > 300) score += 15;
    if (finding.hasHtml) score += 10;
    if (turn.length > (config?.maxAnswerLength || 120)) score += 20;
    if (/感谢|如下|上述|详见|一、|（一）|（二）|功能介绍|pageKey|https?:|\/#\//.test(turn)) score += 20;
    if (R.hasDocumentStructure?.(turn) || R.hasTechnicalNoise?.(turn)) score += 25;
    return score;
  }

  function oralizeAnswerTone(answer, isFirstTurn, config, question) {
    const maxLen = config?.maxAnswerLength || 120;
    let a = R.stripFormalOpenings(answer || '');
    a = a.replace(/^[！!，,\s]+/, '').replace(/^您好[，,!\s]*您好/u, '');
    if (!a || /^[！!，,\s]+$/.test(a)) return '';
    a = R.oralizeFormalPhrases(a);
    a = R.polishVoiceAnswer(a, question || '', maxLen);
    a = a.replace(/[，,]+。$/g, '。').replace(/[，,]$/g, '');
    if (!/[。！？?]$/.test(a)) a += '。';
    return R.enforceTurnLength(a, maxLen, 0);
  }

  /** Phase 3 本地去重审核 */
  function localDedupEntries(entries, config) {
    const valid = entries.filter(e =>
      e.standardQuestion?.trim() && e.answerTurns?.some(t => t.trim())
    );

    const map = new Map();
    const conflicts = [];
    let mergedCount = 0;

    valid.forEach(entry => {
      const key = entry.standardQuestion.replace(/\s/g, '');
      if (!map.has(key)) {
        map.set(key, entry);
        return;
      }
      mergedCount++;
      const existing = map.get(key);
      const existAns = (existing.answerTurns || []).join('');
      const newAns = (entry.answerTurns || []).join('');
      if (existAns !== newAns) {
        existing.conflict = true;
        conflicts.push({
          standardQuestion: entry.standardQuestion,
          answers: [existAns, newAns],
          resolution: '请人工选择保留哪条答案'
        });
      }
    });

    const deduped = [...map.values()].map(e => ({
      ...e,
      categoryPath: R.ensureCategoryPath(e.categoryPath, config.categoryPrefix, config.categoryDepth || 2)
    }));

    return {
      entries: deduped,
      audit: {
        removedCount: valid.length - deduped.length - mergedCount,
        mergedCount,
        conflicts
      },
      stats: buildStats(deduped)
    };
  }

  /** Phase 5 本地相似问生成 */
  function localGenerateSimilarQuestions(entries, config) {
    const n = config.similarQuestionsPerEntry || 8;
    const results = [];

    entries.forEach(entry => {
      const sq = entry.standardQuestion || '';
      const phrases = new Set();
      const base = sq.replace(/[？?]/g, '').trim();

      phrases.add(base);
      if (base.length > 6) phrases.add(base.slice(-Math.min(base.length, 12)));
      if (base.length > 4) phrases.add('请问' + base.slice(0, 10));
      phrases.add(base.replace(/^.*?(系列|版|款)/, ''));

      (entry.keywords || []).slice(0, 3).forEach(kw => {
        phrases.add(kw + '是多少');
        phrases.add(kw + '怎么样');
        phrases.add('咨询' + kw);
      });

      if (base.includes('多少')) phrases.add(base.replace(/多少/, '几'));
      if (base.includes('什么')) phrases.add(base.replace(/什么/, '啥'));
      if (base.includes('怎么')) phrases.add(base.replace(/怎么/, '如何'));
      phrases.add(base.replace(/？/g, '').slice(0, 15));

      const list = [...phrases]
        .map(p => p.replace(/[？?。，,]/g, '').trim())
        .filter(p => p && p.length >= 2 && p.length <= 15)
        .slice(0, n);

      if (list.length) {
        results.push({
          categoryPath: entry.categoryPath,
          standardQuestion: entry.standardQuestion,
          type: '用户相似问',
          phrases: list
        });
      }
    });

    return results;
  }

  function buildStats(entries) {
    const lengths = entries.flatMap(e => e.answerTurns || []).map(t => t.length);
    return {
      totalEntries: entries.length,
      humanRequiredCount: entries.filter(e => e.needsHuman).length,
      avgAnswerLength: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      multiTurnCount: entries.filter(e => (e.answerTurns || []).length > 1).length
    };
  }

  /** 判断是否需要 LLM 补充 */
  function needsLLMExtraction(text, localFindings) {
    if (!localFindings.length) return true;
    if (localFindings.length < 3 && text.length > 2000) return true;
    if (/<[^>]+>/.test(text) && localFindings.length < 5) return true;
    return false;
  }

  function needsLLMVoiceify(entry, entryAfterLocal) {
    if (entry.isComplex && R.detectSensitive((entry.question || '') + R.stripHtml(entry.answer || ''))) return true;
    if ((entry._voiceQuality || 0) >= 25) return true;
    if (entry.hasHtml && (entry.rawAnswerLength || 0) > 80) return true;
    if ((entry.rawAnswerLength || 0) > 350) return true;
    const turn = (entryAfterLocal?.answerTurns || [])[0] || '';
    if (R.isOverlyFormal(turn)) return true;
    return (entryAfterLocal?.answerTurns || []).some(t => t.length > 200);
  }

  function rankForLLM(findings, entries) {
    return findings
      .map((f, i) => ({ finding: f, index: i, entry: entries[i], quality: entries[i]?._voiceQuality || 0 }))
      .filter(({ finding, entry }) => needsLLMVoiceify(finding, entry))
      .sort((a, b) => b.quality - a.quality || (b.finding.rawAnswerLength || 0) - (a.finding.rawAnswerLength || 0));
  }

  global.KVLocalEngine = {
    localExtractFindings,
    localVoiceifyFindings,
    localDedupEntries,
    localGenerateSimilarQuestions,
    needsLLMExtraction,
    needsLLMVoiceify,
    rankForLLM,
    scoreVoiceQuality,
    buildStats
  };
})(window);

/* --- knowledgeTransformPrompts.js --- */
/** Prompt 模板体系 — 对齐设计文档 v2.0 */
(function (global) {
  const CORE_ORALIZATION_RULES = `【核心口语化规则 20 条】
1. 使用"您"称呼用户，"我们"代表企业
2. 先结论后解释，一句一意
3. 单条答案只讲 1 个信息点，参数不超过 3 个
4. 禁止：该/此/上述/点击/查看/扫码
5. 纯文本输出，禁止 HTML
6. 标准问 ≤200 字，用户视角疑问句
7. 单轮答案 ≤maxAnswerLength 字，超长拆为多轮 answerTurns
8. 多型号并列答案必须拆为独立条目
9. 数字按语音播报读法（已由规则引擎预处理）
10. 避免绝对承诺，用"一般/通常"弱化
11. 并列项不超过 3 个，用顿号或"和"连接
12. 步骤类最多 3 步
13. 拒绝类需给替代方案
14. 过期活动标 needsHuman: true
15. 退款/投诉/法律类标 needsHuman: true
16. 保留时间敏感性表述
17. 认证型号逐字读
18. 删除宣传语和冗余修饰
19. 目录路径用 / 分隔两级
20. 输出前自检：空问题/空答案/页码行删除`;

  const SCENARIO_RULES = {
    param_faq: '【参数 FAQ 场景】按编号子问题拆分；多型号拆条；认证型号逐字读；禁止多型号并列播报。',
    activity: '【活动话术场景】保留时间敏感性；已过期活动标 needsHuman；突出活动时间与规则。',
    service: '【服务说明场景】按权益项或流程步骤拆分；退款/投诉类转人工。',
    mixed: '【混合文档场景】自动识别内容类型，参数类按 FAQ 处理，政策类按服务说明处理。'
  };

  const SYSTEM_EXTRACTION = `你是 SmartCS 知识库拆解专家。任务：将整份文档拆为原子级问答（1 个子问题 = 1 条知识）。
规则：
- 编号问答（1. xxx？）每条独立输出
- 文档标题不作为标准问，归入 category/subCategory
- 多实体并列（A：xxx。B：yyy。）拆为多条
- 保留 sourceExcerpt 追溯原文
- 复杂/敏感内容标 isComplex: true
严格返回 JSON，无其他文字。`;

  const SYSTEM_ORALIZATION = `你是 SmartCS 知识库语音化改写专家。将文本知识改写为语音机器人可播报的口语化问答。
语音场景：听一遍就要懂，数字逐字读，禁止 HTML 和指代词。`;

  const SYSTEM_DEDUP = `你是 SmartCS 知识库审核专家。对条目进行语义去重、目录规范化、冲突检测。
规则：
- 合并语义重复的标准问
- 统一同义目录名
- 同一标准问不同答案标 conflict: true
- 删除空问题/空答案/无效行
- 标准问超 200 字自动精简
严格返回 JSON。`;

  const SYSTEM_SIMILAR = `你是 SmartCS 相似问生成专家。为每条标准问生成口语化触发语。
规则：
- 每条生成 N 条相似问（更短、更口语，建议 ≤15 字）
- 覆盖简称、省略主语、口语疑问、ASR 常见变体
- 不引入答案中不存在的信息
- standardQuestion 必须与输入字符级完全一致
严格返回 JSON。`;

  function buildExtractPrompt(config, chunkText, chunkIndex, totalChunks) {
    const docRule = SCENARIO_RULES[config.docType] || SCENARIO_RULES.mixed;
    return `${SYSTEM_EXTRACTION}

企业/品牌：${config.companyName}
业务背景：${config.companyBrief || '未提供'}
文档类型：${config.docType}
${docRule}

当前处理：第 ${chunkIndex + 1}/${totalChunks} 块

请从以下文本提取 RawFinding 数组：
{
  "findings": [{
    "category": "一级分类",
    "subCategory": "二级分类",
    "docTitle": "原文档标题",
    "question": "用户问题",
    "answer": "原始答案",
    "keywords": ["关键词"],
    "sourceExcerpt": "原文片段",
    "isComplex": false
  }]
}

文本内容：
${chunkText}`;
  }

  function buildVoiceifyPrompt(config, findings) {
    const docRule = SCENARIO_RULES[config.docType] || SCENARIO_RULES.mixed;
    return `${SYSTEM_ORALIZATION}

${CORE_ORALIZATION_RULES}
${docRule}

企业/品牌：${config.companyName}
业务背景：${config.companyBrief || '未提供'}
单轮答案字数上限：${config.maxAnswerLength || 120}
多轮答案轮数上限：${config.maxAnswerTurns || 5}
目录层级：${config.categoryDepth || 2}
目录前缀：${config.categoryPrefix || '无'}

待改写条目：
${JSON.stringify(findings, null, 2)}

返回 JSON：
{
  "entries": [{
    "categoryPath": "产品大类/Pro系列",
    "standardQuestion": "用户口语疑问句",
    "summary": "一句话摘要≤50字",
    "answerTurns": ["单轮语音答案"],
    "keywords": ["关键词"],
    "needsHuman": false,
    "transferReason": null,
    "sourceExcerpt": "原文追溯"
  }]
}`;
  }

  function buildDedupPrompt(config, entries) {
    return `${SYSTEM_DEDUP}

企业：${config.companyName}
待审核条目数：${entries.length}

条目数据：
${JSON.stringify(entries.slice(0, 80), null, 2)}

返回 JSON：
{
  "entries": [],
  "removedCount": 0,
  "mergedCount": 0,
  "conflicts": [{"standardQuestion": "", "answers": [], "resolution": ""}],
  "stats": {
    "totalEntries": 0,
    "humanRequiredCount": 0,
    "avgAnswerLength": 0,
    "multiTurnCount": 0
  }
}`;
  }

  function buildSimilarQuestionsPrompt(config, entries) {
    const n = config.similarQuestionsPerEntry || 8;
    const sample = entries.slice(0, 30).map(e => ({
      categoryPath: e.categoryPath,
      standardQuestion: e.standardQuestion
    }));
    return `${SYSTEM_SIMILAR}

每条标准问生成 ${n} 条相似问。

条目：
${JSON.stringify(sample, null, 2)}

返回 JSON：
{
  "similarQuestions": [{
    "categoryPath": "与主表一致",
    "standardQuestion": "与主表字符级完全一致",
    "type": "用户相似问",
    "phrases": ["相似问1", "相似问2"]
  }]
}`;
  }

  global.KVPrompts = {
    buildExtractPrompt,
    buildVoiceifyPrompt,
    buildDedupPrompt,
    buildSimilarQuestionsPrompt
  };
})(window);

/* --- platformExport.js --- */
/** 下游平台 xlsx 导出 — Phase 7 */
(function (global) {
  function validateExport(result, config) {
    const warnings = [];
    const maxLen = config.maxAnswerLength || 120;

    result.entries.forEach(entry => {
      if ((entry.standardQuestion || '').length > 200) {
        warnings.push({ type: 'truncate', message: `标准问超长已截断：${entry.standardQuestion.slice(0, 30)}...` });
      }
      if (!entry.categoryPath || !entry.categoryPath.includes('/')) {
        warnings.push({ type: 'category', message: `目录缺层级：${entry.standardQuestion}` });
      }
      (entry.answerTurns || []).forEach((turn, i) => {
        if (turn.length > maxLen) {
          warnings.push({ type: 'answer', message: `答案第 ${i + 1} 轮超长：${entry.standardQuestion}` });
        }
      });
    });

    const sqSet = new Set(result.entries.map(e => e.standardQuestion));
    result.similarQuestions.forEach(sq => {
      if (!sqSet.has(sq.standardQuestion)) {
        warnings.push({ type: 'consistency', message: `相似问标准问不匹配：${sq.standardQuestion}` });
      }
    });

    return warnings;
  }

  function exportToPlatformXlsx(result, config) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载');

    const warnings = validateExport(result, config);
    const blocked = warnings.some(w => w.type === 'consistency');
    if (blocked) throw new Error('跨 Sheet 标准问不一致，请修正后再导出');

    const wb = XLSX.utils.book_new();

    const qaHeaderRows = [
      ['导入注意事项：请保留表头结构；标准问≤200字；答案按语音控长拆分多行；G列（答案超限内容）语音场景留空'],
      ['*所属目录', '*标准问', '简介类型', '简介内容', '答案类型', '*答案内容', '答案超限内容', '问答召回规则', '生效开始时间', '生效结束时间', '知识标签-对内对外', '知识标签-呼叫模块', '知识标签-工单模块'],
      ['', '', '纯文本', '', '纯文本', '', '', '', '', '', config.defaultTags?.audience || '', config.defaultTags?.callModule || '', config.defaultTags?.ticketModule || '']
    ];

    const qaDataRows = [];
    result.entries.forEach(entry => {
      const R = global.KVTextRules;
      let turns = (entry.answerTurns?.length ? entry.answerTurns : [''])
        .map(t => R ? R.stripCategoryTagsFromAnswer(t) : t)
        .filter(t => t && !(R && R.isCategoryTagOnly(t)));
      if (!turns.length) turns = [''];

      let summary = entry.summary || '';
      if (R && R.isCategoryTagOnly(summary)) {
        summary = R.stripCategoryTagsFromAnswer(turns[0] || '').slice(0, 50);
      }

      turns.forEach((turn, idx) => {
        qaDataRows.push([
          entry.categoryPath,
          entry.standardQuestion,
          idx === 0 ? '纯文本' : '',
          idx === 0 ? summary.slice(0, 50) : '',
          idx === 0 ? '纯文本' : '',
          turn,
          '',
          '',
          '',
          '',
          idx === 0 ? (config.defaultTags?.audience || '') : '',
          idx === 0 ? (config.defaultTags?.callModule || '') : '',
          idx === 0 ? (config.defaultTags?.ticketModule || '') : ''
        ]);
      });
    });

    const qaSheet = XLSX.utils.aoa_to_sheet([...qaHeaderRows, ...qaDataRows]);
    XLSX.utils.book_append_sheet(wb, qaSheet, '问答知识');

    const sqHeaderRows = [
      ['导入注意事项：标准问必须与问答知识 Sheet 字符级完全一致'],
      ['标准问所属目录', '标准问', '相似问类型', '相似问']
    ];
    const sqDataRows = [];
    result.similarQuestions.forEach(sq => {
      (sq.phrases || []).forEach(phrase => {
        sqDataRows.push([
          sq.categoryPath,
          sq.standardQuestion,
          sq.type || '用户相似问',
          phrase.slice(0, 200)
        ]);
      });
    });
    const sqSheet = XLSX.utils.aoa_to_sheet([...sqHeaderRows, ...sqDataRows]);
    XLSX.utils.book_append_sheet(wb, sqSheet, '相似问');

    const filename = `${config.companyName || '知识库'}_语音化导入_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    return { warnings, filename };
  }

  global.KVPlatformExport = {
    validateExport,
    exportToPlatformXlsx
  };
})(window);

/* --- knowledgeTransform.js --- */
/** 主流程编排 — 内置规则优先，LLM 可选增强 */
(function (global) {
  if (!global.KVTextRules || !global.KVPrompts) {
    console.error('[KVTransform] 依赖未加载: KVTextRules=', !!global.KVTextRules, 'KVPrompts=', !!global.KVPrompts);
    global.KVTransform = {
      transformKnowledgeToVoice: () => Promise.reject(new Error('脚本模块未完整加载，请 Ctrl+Shift+R 强制刷新页面')),
      parseUploadedFile: () => Promise.reject(new Error('脚本模块未完整加载，请 Ctrl+Shift+R 强制刷新页面')),
      analyzeUploadedFile: () => Promise.reject(new Error('脚本模块未完整加载，请 Ctrl+Shift+R 强制刷新页面'))
    };
    return;
  }

  const { preprocessText, applyLayer1ToEntry, chunkText, ensureCategoryPath, stripHtml } = global.KVTextRules;
  const { buildExtractPrompt, buildVoiceifyPrompt, buildDedupPrompt, buildSimilarQuestionsPrompt } = global.KVPrompts;

  function getLocalEngine() {
    const engine = global.KVLocalEngine;
    if (!engine || typeof engine.localExtractFindings !== 'function') {
      throw new Error('内置规则引擎未加载。请按 Ctrl+Shift+R 强制刷新页面；若仍失败，请检查 /tools/knowledge-voice/localKnowledgeEngine.js 是否可访问。');
    }
    return engine;
  }

  function safeJsonParse(content) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('无法解析 AI 返回 JSON');
    return JSON.parse(match[0]);
  }

  async function callLLM(messages, model = 'deepseek-chat') {
    const response = await fetch('/api/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'limuzi2025',
        model,
        messages,
        temperature: 0.4
      })
    });
    if (!response.ok) throw new Error('API 调用失败');
    const data = await response.json();
    return data.choices[0].message.content;
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function rawToFinding(item, config) {
    const categoryPath = ensureCategoryPath(
      [item.category, item.subCategory].filter(Boolean).join('/') || item.category,
      config.categoryPrefix,
      config.categoryDepth || 2
    );
    return {
      categoryPath,
      category: item.category,
      subCategory: item.subCategory,
      question: item.question,
      answer: item.answer,
      keywords: item.keywords || [],
      sourceExcerpt: item.sourceExcerpt || '',
      isComplex: !!item.isComplex
    };
  }

  async function phase1Extract(text, config, onProgress) {
    onProgress?.({ phase: 'extracting', message: '内置规则拆解中...' });
    const localFindings = getLocalEngine().localExtractFindings(text, config);

    if (!config.enableLLMEnhance || !getLocalEngine().needsLLMExtraction(text, localFindings)) {
      onProgress?.({
        phase: 'extracting',
        message: '内置规则提取完成（' + localFindings.length + ' 条）'
      });
      return localFindings;
    }

    onProgress?.({ phase: 'extracting', message: '内置规则不足，AI 补充拆解...' });
    const preprocessed = preprocessText(text, config);
    const chunks = chunkText(preprocessed);
    const llmFindings = [];

    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        phase: 'extracting',
        currentChunk: i + 1,
        totalChunks: chunks.length,
        message: 'AI 补充提取 (' + (i + 1) + '/' + chunks.length + ')...'
      });
      try {
        const prompt = buildExtractPrompt(config, chunks[i], i, chunks.length);
        const content = await callLLM([{ role: 'user', content: prompt }]);
        const parsed = safeJsonParse(content);
        (parsed.findings || []).forEach(f => llmFindings.push(rawToFinding(f, config)));
      } catch (e) {
        console.warn('LLM extract chunk failed', e);
      }
      if (i < chunks.length - 1) await sleep(600);
    }

    return llmFindings.length ? llmFindings : localFindings;
  }

  async function phase2Voiceify(findings, config, onProgress) {
    onProgress?.({ phase: 'voiceifying', message: '内置规则深度口语化中...' });
    let entries = getLocalEngine().localVoiceifyFindings(findings, config);

    if (!config.enableLLMEnhance) {
      onProgress?.({
        phase: 'voiceifying',
        message: '内置深度口语化完成（' + entries.length + ' 条）'
      });
      return entries;
    }

    const maxLlm = config.llmVoiceifyMaxEntries;
    let toProcess;
    let llmCandidates = findings.length;
    if (maxLlm > 0) {
      const ranked = getLocalEngine().rankForLLM(findings, entries);
      if (!ranked.length) {
        onProgress?.({ phase: 'voiceifying', message: '内置规则完成（' + entries.length + ' 条，质量已达标）' });
        return entries;
      }
      llmCandidates = ranked.length;
      toProcess = ranked.slice(0, maxLlm);
    } else {
      toProcess = findings.map((f, i) => ({ finding: f, index: i }));
    }
    const llmSkipped = llmCandidates - toProcess.length;

    onProgress?.({
      phase: 'voiceifying',
      message: 'AI 大模型逐条精修中 (0/' + toProcess.length + '，请保持页面打开)...'
    });

    const llmDelayMs = config.llmRequestDelayMs || 400;
    for (let i = 0; i < toProcess.length; i++) {
      const item = toProcess[i];
      const batchPayload = [{
        categoryPath: item.finding.categoryPath,
        question: item.finding.question,
        answer: stripHtml(item.finding.answer || '').slice(0, 1200),
        keywords: item.finding.keywords,
        sourceExcerpt: item.finding.sourceExcerpt
      }];

      onProgress?.({
        phase: 'voiceifying',
        message: 'AI 大模型逐条精修中 (' + (i + 1) + '/' + toProcess.length + ')...'
      });

      try {
        const prompt = buildVoiceifyPrompt(config, batchPayload);
        const content = await callLLM([{ role: 'user', content: prompt }]);
        const parsed = safeJsonParse(content);
        const e = (parsed.entries || [])[0];
        const targetIdx = item.index;
        if (e && targetIdx >= 0) {
          const refined = applyLayer1ToEntry({
            categoryPath: e.categoryPath || findings[targetIdx].categoryPath,
            question: e.standardQuestion || findings[targetIdx].question,
            answer: (e.answerTurns || []).join(''),
            summary: e.summary,
            keywords: e.keywords,
            sourceExcerpt: e.sourceExcerpt,
            hasHtml: false,
            rawAnswerLength: (e.answerTurns || []).join('').length
          }, config);
          entries[targetIdx] = {
            ...refined,
            standardQuestion: e.standardQuestion || refined.standardQuestion,
            summary: e.summary || refined.summary,
            answerTurns: e.answerTurns?.length ? e.answerTurns : refined.answerTurns,
            needsHuman: e.needsHuman || refined.needsHuman,
            _llmRefined: true
          };
        }
      } catch (e) {
        console.warn('LLM voiceify entry failed', item.index, e);
      }
      if (i < toProcess.length - 1) await sleep(llmDelayMs);
    }

    entries.llmMeta = {
      llmSkipped,
      llmProcessed: toProcess.length,
      llmCandidates: maxLlm > 0 ? toProcess.length + llmSkipped : findings.length
    };

    return entries;
  }

  async function phase3Dedup(entries, config, onProgress) {
    onProgress?.({ phase: 'deduplicating', message: '内置规则去重审核中...' });
    const localResult = getLocalEngine().localDedupEntries(entries, config);

    if (!config.enableLLMEnhance || entries.length <= 30) {
      return localResult;
    }

    onProgress?.({ phase: 'deduplicating', message: 'AI 语义去重补充...' });
    try {
      const prompt = buildDedupPrompt(config, localResult.entries);
      const content = await callLLM([{ role: 'user', content: prompt }]);
      const parsed = safeJsonParse(content);
      if (!parsed.entries?.length) return localResult;

      const deduped = parsed.entries.map((e, idx) => {
        const base = applyLayer1ToEntry({
          categoryPath: e.categoryPath,
          question: e.standardQuestion,
          answer: (e.answerTurns || []).join(''),
          summary: e.summary,
          keywords: e.keywords,
          sourceExcerpt: e.sourceExcerpt
        }, config);
        return {
          ...base,
          standardQuestion: e.standardQuestion || base.standardQuestion,
          summary: e.summary || base.summary,
          answerTurns: e.answerTurns || base.answerTurns,
          needsHuman: e.needsHuman ?? base.needsHuman,
          conflict: e.conflict ?? false
        };
      });

      return {
        entries: deduped,
        audit: {
          removedCount: (localResult.audit.removedCount || 0) + (parsed.removedCount || 0),
          mergedCount: (localResult.audit.mergedCount || 0) + (parsed.mergedCount || 0),
          conflicts: [...(localResult.audit.conflicts || []), ...(parsed.conflicts || [])]
        },
        stats: parsed.stats || getLocalEngine().buildStats(deduped)
      };
    } catch {
      return localResult;
    }
  }

  async function phase5SimilarQuestions(entries, config, onProgress) {
    if (!config.generateSimilarQuestions) return [];

    onProgress?.({ phase: 'generating_similar', message: '内置规则生成相似问...' });
    const localSimilar = getLocalEngine().localGenerateSimilarQuestions(entries, config);

    if (!config.enableLLMEnhance) return localSimilar;

    onProgress?.({ phase: 'generating_similar', message: 'AI 补充相似问...' });
    try {
      const prompt = buildSimilarQuestionsPrompt(config, entries.slice(0, 30));
      const content = await callLLM([{ role: 'user', content: prompt }]);
      const parsed = safeJsonParse(content);
      const llmSimilar = parsed.similarQuestions || [];
      if (!llmSimilar.length) return localSimilar;

      const map = new Map(localSimilar.map(s => [s.standardQuestion, s]));
      llmSimilar.forEach(sq => {
        if (map.has(sq.standardQuestion)) {
          const existing = map.get(sq.standardQuestion);
          existing.phrases = [...new Set([...(existing.phrases || []), ...(sq.phrases || [])])]
            .slice(0, config.similarQuestionsPerEntry || 8);
        } else {
          map.set(sq.standardQuestion, sq);
        }
      });
      return [...map.values()];
    } catch {
      return localSimilar;
    }
  }

  async function transformKnowledgeToVoice(rawText, config, onProgress) {
    const start = Date.now();

    onProgress?.({ phase: 'parsing', message: '正在解析文件结构（内置规则）...' });
    await sleep(200);

    const findings = await phase1Extract(rawText, config, onProgress);
    if (!findings.length) {
      throw new Error('未能从输入中提取到知识条目，请检查内容格式');
    }

    let entries = await phase2Voiceify(findings, config, onProgress);
    const llmMeta = entries.llmMeta;
    if (entries.llmMeta) delete entries.llmMeta;
    const dedupResult = await phase3Dedup(entries, config, onProgress);
    entries = dedupResult.entries;

    const similarQuestions = await phase5SimilarQuestions(entries, config, onProgress);

    onProgress?.({
      phase: 'exporting',
      message: config.enableLLMEnhance ? '转换完成（内置 + AI 增强）' : '转换完成（内置规则）'
    });

    const stats = {
      ...dedupResult.stats,
      totalSourceDocs: 1,
      totalSimilarQuestions: similarQuestions.reduce((n, sq) => n + (sq.phrases?.length || 0), 0),
      processingTimeMs: Date.now() - start,
      processingMode: config.enableLLMEnhance ? 'builtin+llm' : 'builtin'
    };

    const warnings = [];
    if (llmMeta?.llmSkipped > 0) {
      warnings.push({
        type: 'llm_cap',
        message: 'AI 大模型已逐条精修 ' + llmMeta.llmProcessed + ' 条，另有 ' + llmMeta.llmSkipped + ' 条仍用内置深度口语化（单次上限 ' + config.llmVoiceifyMaxEntries + ' 条）。'
      });
    } else if (llmMeta?.llmProcessed > 0) {
      warnings.push({
        type: 'llm_done',
        message: 'AI 大模型已逐条精修 ' + llmMeta.llmProcessed + ' 条。'
      });
    }
    if (!config.enableLLMEnhance) {
      warnings.push({
        type: 'builtin_only',
        message: '本次使用内置深度口语化处理 ' + entries.length + ' 条（未调用大模型，耗时约 ' + Math.round((Date.now() - start) / 1000) + ' 秒）。勾选「AI 增强」可对质量最差的条目再精修。'
      });
    }

    return {
      companyName: config.companyName,
      entries,
      similarQuestions,
      audit: dedupResult.audit,
      stats,
      warnings
    };
  }

  async function parseUploadedFile(file, options = {}) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      return await file.text();
    }
    if (name.endsWith('.csv')) {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const rows = fileToRows(text);
      if (isPlatformTemplateRows(rows) && !options.columnMapping) return parsePlatformXlsxRows(rows);
      return parseStructuredRows(rows, options);
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载，无法解析 Excel');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets['问答知识'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (isPlatformTemplateRows(rows) && !options.columnMapping) return parsePlatformXlsxRows(rows);
      return parseStructuredRows(rows, options);
    }
    throw new Error('不支持的文件格式，请上传 .txt / .md / .csv / .xlsx');
  }

  function fileToRows(text) {
    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.read(text, { type: 'string', raw: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }
    return parseCsvLines(text);
  }

  function joinRowCells(row) {
    return (row || []).map(c => String(c ?? '')).join('|');
  }

  function isPlatformTemplateRows(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const line = joinRowCells(rows[i]);
      if (line.includes('标准问') && (line.includes('答案') || line.includes('所属目录'))) return true;
    }
    return false;
  }

  const QUESTION_HEADERS = ['标准问', '问题', '问句', '用户问题', '用户问', '提问', 'question', 'query', 'faq_question', 'std_question', 'ask', 'q_text', 'question_text', 'title', '标题'];
  const ANSWER_HEADERS = ['答案内容', '答案', '内容', '回复', '解答', 'answer', 'content', 'response', 'faq_answer', 'reply', 'answer_content', '简介内容', 'a_text', 'answer_text', '话术', '播报'];
  const CATEGORY_PATH_HEADERS = ['所属目录', '目录路径', '知识路径', 'category_path', 'full_path', 'catalog_path', '知识目录'];
  const CATEGORY_PART_HEADERS = ['category_name', 'sub_category', 'parent_category', 'product_line', '一级目录', '二级目录', '三级目录', '目录', '分类', 'category', '所属分类', '品类', '类目', '产品线', '业务线', '模块', '部门', 'catalog', 'folder', 'module', 'dept', '一级', '二级', '三级', 'level1', 'level2', 'level3', '标签', 'tag_name', 'biz_type', '业务类型', '知识分类'];
  const SKIP_CATEGORY_HEADERS = ['oss_path', 'file_path', 'filepath', 'storage_path', 'object_key', 's3_path', 'bucket', 'url', 'uri', 'link', 'href', 'image', 'img', 'avatar', 'icon'];
  const SKIP_HEADERS = ['id', '_id', 'uuid', 'question_id', 'answer_id', 'category_id', 'parent_id', 'workflow_id', 'created_at', 'updated_at', 'create_time', 'update_time', 'deleted', 'status', 'type', 'sort', 'order', 'version'];

  function shouldSkipHeader(h) {
    if (!h) return true;
    if (SKIP_HEADERS.some(skip => h === skip || h.endsWith('_' + skip))) return true;
    return h.includes('_id') || h.endsWith('_id');
  }

  function headerMatches(h, keywords) {
    return keywords.some(k => {
      const key = k.toLowerCase();
      return h === key || h.includes(key);
    });
  }

  function isQuestionHeader(h) {
    return !shouldSkipHeader(h) && headerMatches(h, QUESTION_HEADERS) && !headerMatches(h, ANSWER_HEADERS);
  }

  function isAnswerHeader(h) {
    return !shouldSkipHeader(h) && headerMatches(h, ANSWER_HEADERS) && !headerMatches(h, QUESTION_HEADERS);
  }

  function isCategoryHeaderExcluded(h) {
    if (!h) return true;
    return SKIP_CATEGORY_HEADERS.some(skip => h === skip || h.includes(skip));
  }

  function isCategoryPathHeader(h) {
    if (shouldSkipHeader(h) || isCategoryHeaderExcluded(h)) return false;
    if (h === 'path' || h.endsWith('_path')) return false;
    return headerMatches(h, CATEGORY_PATH_HEADERS);
  }

  function isCategoryPartHeader(h) {
    if (shouldSkipHeader(h) || isCategoryHeaderExcluded(h)) return false;
    if (isQuestionHeader(h) || isAnswerHeader(h)) return false;
    if (/简介|summary|desc|remark|note|comment|memo|content|answer|title|question/.test(h)) return false;
    return headerMatches(h, CATEGORY_PART_HEADERS) || /^(cat|dir|level|l)\d*$/.test(h);
  }

  function categoryLevelFromHeader(h) {
    const m = h.match(/(一级|二级|三级|level\s*(\d)|l(\d)|目录\s*(\d))/);
    if (!m) return 99;
    if (m[1] === '一级') return 1;
    if (m[1] === '二级') return 2;
    if (m[1] === '三级') return 3;
    return +(m[2] || m[3] || m[4] || 99);
  }

  function emptyMapping() {
    return { categories: [], question: -1, answer: -1, summary: -1 };
  }

  function normalizeManualMapping(input) {
    const mapping = emptyMapping();
    if (!input) return mapping;
    mapping.question = Number.isInteger(input.question) ? input.question : -1;
    mapping.answer = Number.isInteger(input.answer) ? input.answer : -1;
    mapping.summary = Number.isInteger(input.summary) ? input.summary : -1;
    if (Array.isArray(input.categories)) {
      mapping.categories = input.categories.filter(idx => Number.isInteger(idx) && idx >= 0);
    } else if (Number.isInteger(input.category) && input.category >= 0) {
      mapping.categories = [input.category];
    }
    return mapping;
  }

  function detectColumnMapping(headerRow) {
    const headers = (headerRow || []).map((h, idx) => ({ idx, norm: normalizeHeaderName(h), raw: String(h ?? '').trim() }));
    const mapping = emptyMapping();
    const categoryParts = [];

    headers.forEach(({ idx, norm }) => {
      if (shouldSkipHeader(norm)) return;
      if (mapping.question < 0 && isQuestionHeader(norm)) mapping.question = idx;
      if (mapping.answer < 0 && isAnswerHeader(norm)) mapping.answer = idx;
      if (isCategoryPathHeader(norm)) mapping.categories = [idx];
      else if (isCategoryPartHeader(norm)) categoryParts.push({ idx, level: categoryLevelFromHeader(norm) });
      if (mapping.summary < 0 && /简介|summary|desc|description|remark/.test(norm)) mapping.summary = idx;
    });

    if (!mapping.categories.length && categoryParts.length) {
      mapping.categories = categoryParts
        .sort((a, b) => a.level - b.level || a.idx - b.idx)
        .map(item => item.idx);
    }
    return mapping;
  }

  function buildCategoryFromCells(cells, mapping) {
    const indexes = (mapping.categories || []).filter(idx => idx >= 0);
    const parts = indexes.map(idx => String(cells[idx] ?? '').trim()).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1 && /[/>\\|]/.test(parts[0])) {
      return parts[0];
    }
    return parts.join('/');
  }

  function findCategoryValuesInRow(cells, mapping) {
    const R = global.KVTextRules;
    const used = new Set([mapping.question, mapping.answer, mapping.summary, ...(mapping.categories || [])]);
    const scored = [];
    cells.forEach((val, idx) => {
      if (used.has(idx)) return;
      const s = String(val ?? '').trim();
      if (!R.isReadableCategoryValue(s)) return;
      let score = /[\u4e00-\u9fa5]/.test(s) ? 5 : 1;
      if (/产品|活动|服务|会员|参数|售后|咨询|营销|品类|系列|电动/.test(s)) score += 3;
      if (s.length >= 2 && s.length <= 12) score += 1;
      scored.push({ val: s, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map(s => s.val);
  }

  function resolveCategoryPath(cells, mapping, question, options = {}) {
    const R = global.KVTextRules;
    const companyName = options.companyName || '';
    let raw = buildCategoryFromCells(cells, mapping);

    const mappedParts = (mapping.categories || [])
      .map(idx => String(cells[idx] ?? '').trim())
      .filter(Boolean);
    const mappedLooksTechnical = mappedParts.length > 0 && mappedParts.every(v => R.isTechnicalPathValue(v) || !R.isReadableCategoryValue(v));

    if (mappedLooksTechnical || !raw || R.isTechnicalPathValue(raw)) {
      const auto = findCategoryValuesInRow(cells, mapping);
      if (auto.length) raw = auto.join('/');
    }

    return R.buildReadableCategory(raw, question, companyName);
  }

  function buildColumnList(headerRow, dataRows) {
    const colCount = Math.max(
      headerRow.length,
      ...dataRows.slice(0, 30).map(r => (r || []).length),
      0
    );
    return Array.from({ length: colCount }, (_, idx) => {
      const name = String(headerRow[idx] ?? '').trim() || ('列 ' + (idx + 1));
      const sample = dataRows.slice(0, 5)
        .map(r => String((r || [])[idx] ?? '').trim())
        .find(Boolean) || '';
      return { index: idx, name, sample: sample.slice(0, 48) };
    });
  }

  function resolveStructuredContext(rows, options = {}) {
    const cleanRows = (rows || []).filter(r => r && r.some(c => String(c ?? '').trim()));
    if (!cleanRows.length) throw new Error('CSV/表格解析失败：文件为空');

    const headerIdx = Number.isInteger(options.headerRowIndex) ? options.headerRowIndex : findHeaderRowIndex(cleanRows);
    const headerRow = cleanRows[headerIdx] || [];
    const dataRows = cleanRows.slice(headerIdx + 1);
    let mapping;
    let mappingSource = 'header';

    if (options.columnMapping) {
      mapping = normalizeManualMapping(options.columnMapping);
      mappingSource = 'manual';
    } else {
      mapping = detectColumnMapping(headerRow);
      if (mapping.question < 0 || mapping.answer < 0) {
        mapping = inferColumnsByContent(dataRows.length ? dataRows : cleanRows);
        mappingSource = 'content';
      }
    }

    return { cleanRows, headerIdx, headerRow, dataRows, mapping, mappingSource };
  }

  function rowToStructuredItem(cells, mapping, R, options = {}) {
    const question = cells[mapping.question] || '';
    let answer = cells[mapping.answer] || '';
    const category = resolveCategoryPath(cells, mapping, question, options);
    const summary = mapping.summary >= 0 ? (cells[mapping.summary] || '') : '';

    if (!isValidQuestion(question)) return null;
    if (!isValidAnswer(answer)) {
      if (isValidAnswer(summary)) answer = summary;
      else return null;
    }
    if (R.isCategoryTagOnly(answer)) return null;

    return { cat: category, q: question, summary, answers: [answer] };
  }

  function analyzeStructuredRows(rows, options = {}) {
    const ctx = resolveStructuredContext(rows, options);
    const R = global.KVTextRules;
    const previewRows = [];
    let validRowCount = 0;

    ctx.dataRows.forEach(row => {
      const cells = (row || []).map(c => String(c ?? '').trim());
      if (!cells.some(Boolean)) return;
      const item = rowToStructuredItem(cells, ctx.mapping, R, options);
      if (!item) return;
      validRowCount++;
      if (previewRows.length < 5) {
        previewRows.push({
          question: item.q,
          answer: item.answers[0],
          category: item.cat
        });
      }
    });

    return {
      headerRowIndex: ctx.headerIdx,
      columns: buildColumnList(ctx.headerRow, ctx.dataRows),
      mapping: ctx.mapping,
      mappingSource: ctx.mappingSource,
      previewRows,
      validRowCount,
      totalDataRows: ctx.dataRows.length,
      isPlatformTemplate: isPlatformTemplateRows(ctx.cleanRows)
    };
  }

  async function readFileToRows(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      return fileToRows(text);
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载，无法解析 Excel');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets['问答知识'] || wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }
    throw new Error('列映射分析仅支持 csv / xlsx 文件');
  }

  async function analyzeUploadedFile(file, options = {}) {
    const rows = await readFileToRows(file);
    if (isPlatformTemplateRows(rows)) {
      return {
        isPlatformTemplate: true,
        columns: [],
        mapping: null,
        mappingSource: 'platform',
        previewRows: [],
        validRowCount: 0,
        totalDataRows: rows.length,
        headerRowIndex: findXlsxDataStartRow(rows)
      };
    }
    return { ...analyzeStructuredRows(rows, options), isPlatformTemplate: false };
  }

  function isSnowflakeId(value) {
    const s = String(value ?? '').trim();
    return /^\d{15,20}$/.test(s);
  }

  function isValidQuestion(value) {
    const s = String(value ?? '').trim();
    if (!s || s.length < 2) return false;
    if (/^(undefined|null|nan)$/i.test(s)) return false;
    if (isSnowflakeId(s)) return false;
    if (/^\d+$/.test(s) && s.length > 6) return false;
    return true;
  }

  function isValidAnswer(value) {
    const s = String(value ?? '').trim();
    if (!s || s.length < 2) return false;
    if (/^(undefined|null|nan)$/i.test(s)) return false;
    if (isSnowflakeId(s)) return false;
    if (/^\d+$/.test(s) && s.length > 6) return false;
    return true;
  }

  function normalizeHeaderName(value) {
    return String(value ?? '').trim().toLowerCase().replace(/^\*+/, '');
  }

  function columnStats(samples) {
    const R = global.KVTextRules;
    const values = samples.map(v => String(v ?? '').trim()).filter(Boolean);
    if (!values.length) return { count: 0, avgLen: 0, idRatio: 1, questionRatio: 0, answerRatio: 0, categoryQuality: 0 };
    const avgLen = values.reduce((n, v) => n + v.length, 0) / values.length;
    const idRatio = values.filter(isSnowflakeId).length / values.length;
    const questionRatio = values.filter(v =>
      isValidQuestion(v) && (/[？?]/.test(v) || /^(如何|怎么|什么|哪些|是否|能否|可以|多少|为什么|哪里|哪个|请问)/.test(v))
    ).length / values.length;
    const answerRatio = values.filter(v => isValidAnswer(v) && v.length >= 8).length / values.length;
    const categoryQuality = values.filter(v => R.isReadableCategoryValue(v)).length / values.length;
    return { count: values.length, avgLen, idRatio, questionRatio, answerRatio, categoryQuality };
  }

  function inferColumnsByContent(rows) {
    const sampleRows = rows.slice(0, Math.min(rows.length, 200));
    const colCount = Math.max(...sampleRows.map(r => (r || []).length), 0);
    const scores = [];

    for (let col = 0; col < colCount; col++) {
      const samples = sampleRows.map(r => (r || [])[col]).filter(v => String(v ?? '').trim());
      const stats = columnStats(samples);
      if (!stats.count) continue;
      scores.push({
        col,
        stats,
        questionScore: stats.questionRatio * 3 + (stats.avgLen > 4 && stats.avgLen < 120 ? 1 : 0) - stats.idRatio * 4,
        answerScore: stats.answerRatio * 3 + Math.min(stats.avgLen / 40, 2) - stats.idRatio * 5,
        categoryScore: stats.categoryQuality * 5 + (stats.avgLen > 1 && stats.avgLen < 20 ? 1 : 0) + (stats.idRatio < 0.2 ? 0.5 : -2) - stats.questionRatio - (stats.categoryQuality < 0.2 ? 3 : 0)
      });
    }

    const byQuestion = [...scores].sort((a, b) => b.questionScore - a.questionScore);
    const byAnswer = [...scores].sort((a, b) => b.answerScore - a.answerScore);
    const byCategory = [...scores].sort((a, b) => b.categoryScore - a.categoryScore);

    let question = byQuestion.find(s => s.questionScore > 0.5 && s.stats.idRatio < 0.3)?.col ?? -1;
    let answer = byAnswer.find(s => s.answerScore > 0.8 && s.stats.idRatio < 0.2 && s.col !== question)?.col ?? -1;

    if (question < 0) {
      question = byQuestion.find(s => s.stats.idRatio < 0.2 && s.stats.avgLen >= 4 && s.stats.avgLen <= 150)?.col ?? -1;
    }
    if (answer < 0) {
      answer = byAnswer.find(s => s.stats.idRatio < 0.15 && s.stats.avgLen >= 10 && s.col !== question)?.col ?? -1;
    }

    const categoryCols = byCategory
      .filter(s => s.col !== question && s.col !== answer && s.stats.idRatio < 0.2 && s.stats.categoryQuality >= 0.3 && s.categoryScore > 0)
      .slice(0, 3)
      .map(s => s.col)
      .sort((a, b) => a - b);

    return { categories: categoryCols, question, answer, summary: -1 };
  }

  function findHeaderRowIndex(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = rows[i] || [];
      const line = joinRowCells(row);
      if (line.includes('标准问') || line.includes('question') || line.includes('问题')) return i;
      const nonEmpty = row.filter(c => String(c ?? '').trim()).length;
      if (nonEmpty >= 3) {
        const mapping = detectColumnMapping(row);
        if (mapping.question >= 0 && mapping.answer >= 0) return i;
      }
    }
    return 0;
  }

  /** 通用表格/CSV：自动识别问题、答案、目录列，过滤 ID 与无效行 */
  function parseStructuredRows(rows, options = {}) {
    const R = global.KVTextRules;
    const ctx = resolveStructuredContext(rows, options);

    if (ctx.mapping.question < 0 || ctx.mapping.answer < 0) {
      throw new Error('无法识别表格中的「问题」和「答案」列。请在左侧手动指定列映射，或确认文件含标准问/答案字段。');
    }

    const blocks = [];
    ctx.dataRows.forEach(row => {
      const cells = (row || []).map(c => String(c ?? '').trim());
      if (!cells.some(Boolean)) return;
      const item = rowToStructuredItem(cells, ctx.mapping, R, options);
      if (item) blocks.push(item);
    });

    const text = blocks.map(b => {
      let fullAnswer = b.answers.join('').trim();
      fullAnswer = R.stripCategoryTagsFromAnswer(fullAnswer);
      if (!fullAnswer && b.summary && !R.isCategoryTagOnly(b.summary) && b.summary.length > 8) {
        fullAnswer = R.stripCategoryTagsFromAnswer(b.summary);
      }
      if (!fullAnswer || !isValidAnswer(fullAnswer)) return '';
      let block = '\u3010' + (b.cat || '通用') + '\u3011\n问：' + b.q + '\n答：' + fullAnswer;
      const tag = R.extractCategoryTag(b.summary);
      if (tag) block += '\n分类：' + tag;
      return block;
    }).filter(Boolean).join('\n\n');

    if (!text) {
      throw new Error('表格解析结果为空：未找到有效的问答内容。请检查列映射，或确认答案列不是纯数字 ID。');
    }
    return text;
  }

  function parseCsvLines(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const pushCell = () => { row.push(cell); cell = ''; };
    const pushRow = () => {
      if (row.length || cell) {
        pushCell();
        rows.push(row);
        row = [];
      }
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') { cell += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if ((ch === ',' && !inQuotes) || ch === '\t') {
        pushCell();
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && next === '\n') i++;
        pushRow();
      } else {
        cell += ch;
      }
    }
    pushRow();
    return rows.filter(r => r.some(c => String(c ?? '').trim()));
  }

  /** 解析平台 xlsx：合并多行答案，不把分类标签当答案 */
  function parsePlatformXlsxRows(rows) {
    const R = global.KVTextRules;
    const startRow = findXlsxDataStartRow(rows);
    const dataRows = rows.slice(startRow);
    const blocks = [];
    let current = null;

    dataRows.forEach(row => {
      if (!row || !row.some(cell => String(cell || '').trim())) return;

      const cols = normalizeXlsxRow(row);
      const cat = cols.category;
      const q = cols.question;
      const summary = cols.summary;
      let answer = cols.answer;

      // 答案列若仅为标签，尝试从后续列或简介中找实质内容
      if ((!answer || R.isCategoryTagOnly(answer)) && cols.answerAlt) {
        answer = cols.answerAlt;
      }
      if ((!answer || R.isCategoryTagOnly(answer)) && summary && !R.isCategoryTagOnly(summary) && summary.length > 8) {
        answer = summary;
      }

      if (q) {
        if (current) blocks.push(current);
        current = { cat, q, summary, answers: [] };
      } else if (answer && current) {
        // 续行：仅答案列有内容
        if (!R.isCategoryTagOnly(answer)) current.answers.push(answer);
        return;
      }
      if (!current) return;

      if (cat && !current.cat) current.cat = cat;
      if (summary && !current.summary) current.summary = summary;

      if (answer && !R.isCategoryTagOnly(answer)) {
        current.answers.push(answer);
      }
    });
    if (current) blocks.push(current);

    const text = blocks.map(b => {
      let fullAnswer = b.answers.join('').trim();
      fullAnswer = R.stripCategoryTagsFromAnswer(fullAnswer);
      if (!fullAnswer && b.summary && !R.isCategoryTagOnly(b.summary) && b.summary.length > 8) {
        fullAnswer = R.stripCategoryTagsFromAnswer(b.summary);
      }
      if (!fullAnswer) return '';
      const tag = R.extractCategoryTag(b.summary) || b.answers.find(a => R.isCategoryTagOnly(a));
      let block = '\u3010' + (b.cat || '通用') + '\u3011\n问：' + b.q + '\n答：' + fullAnswer;
      if (tag) block += '\n分类：' + tag;
      return block;
    }).filter(Boolean).join('\n\n');

    if (!text) {
      throw new Error('Excel 解析结果为空：未找到有效的「标准问 + 答案内容」。请确认文件含「问答知识」Sheet，且答案列有实质内容（不能只有【分类】标签）。');
    }
    return text;
  }

  function findXlsxDataStartRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i] || [];
      const line = row.map(c => String(c || '')).join('|');
      if (line.includes('标准问') && (line.includes('答案') || line.includes('所属目录'))) {
        // 双行表头：下一行可能是标签示例，再下一行才是数据
        const next = rows[i + 1] || [];
        const nextLine = next.map(c => String(c || '')).join('|');
        if (nextLine.includes('纯文本') || nextLine.includes('知识标签')) return i + 2;
        return i + 1;
      }
    }
    return 3;
  }

  function normalizeXlsxRow(row) {
    const cells = row.map(c => String(c ?? '').trim());
    // 平台模板：A目录 B标准问 D简介 F答案 G超限
    if (cells[1] && (cells[1].includes('？') || cells[1].includes('?') || cells[1].length > 4)) {
      return {
        category: cells[0],
        question: cells[1],
        summary: cells[3] || '',
        answer: cells[5] || cells[4] || '',
        answerAlt: cells[6] || ''
      };
    }
    // 通用三列：目录/问题/答案
    return {
      category: cells[0] || '通用',
      question: cells[1] || cells[0],
      summary: '',
      answer: cells[2] || cells[1] || '',
      answerAlt: cells[3] || ''
    };
  }

  global.KVTransform = {
    transformKnowledgeToVoice,
    parseUploadedFile,
    analyzeUploadedFile,
    parsePlatformXlsxRows,
    parseStructuredRows,
    analyzeStructuredRows,
    safeJsonParse
  };
})(window);


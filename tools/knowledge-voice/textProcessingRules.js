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
    result = result.replace(/<[^>]+>/g, '');
    Object.entries(HTML_ENTITIES).forEach(([entity, ch]) => {
      result = result.replaceAll(entity, ch);
    });
    return result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
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

    // 去掉 pipe 品类后缀（标准问/标题里常见）
    result = result.replace(/\s*\|\s*[^|\n]{1,30}$/gm, '');

    // 大类标题：1 产品类 / 2 服务类
    result = result.replace(/(?:^|\n|\s)\d{1,2}\s*[\u4e00-\u9fa5A-Za-z]{2,8}类\s*/g, ' ');

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
    '服务说明', '权益说明', '保修说明', '退换说明', '常见问题', '问题解答', '答复如下'
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
    /欢迎(?:您)?(?:随时)?(?:联系|咨询)(?:我们|客服)[^。；]*[。；]?/g
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
    const words = (String(question ?? '').match(/[\u4e00-\u9fa5]{2,8}/g) || [])
      .filter(w => !QUESTION_STOPWORDS.has(w));
    return [...new Set(words)].slice(0, 8);
  }

  function splitIntoClauses(text) {
    return String(text ?? '')
      .split(/(?=第[一二三四五六七八九十\d]+，)|[。；！？\n]+/)
      .map(s => s.trim()
        .replace(/^第[一二三四五六七八九十\d]+，/, '')
        .replace(/^[•·●○◆▪\-—]\s*/, ''))
      .filter(s => s.length > 4 && !/^[\d\s类]+$/.test(s) && !CS_SECTION_HEADERS.includes(s.replace(/[：:。，,\s]/g, '')));
  }

  function scoreClauseForQuestion(clause, questionKeywords) {
    let score = 0;
    const s = clause.trim();
    if (s.length < 6 || s.length > 200) score -= 3;
    if (/感谢|尊敬|亲爱的|如下|上述|详见|敬请|抱歉给您/.test(s)) score -= 8;
    if (/可以|能够|支持|享受|获得|领取|兑换|参与|办理|申请|保修|退换|到店|鼓励|监督|反馈/.test(s)) score += 6;
    if (/一般|通常|建议|需要|必须|仅限|每人|每次|有效期|截止/.test(s)) score += 3;
    questionKeywords.forEach(kw => {
      if (s.includes(kw)) score += 12;
      else if (kw.length >= 3 && s.includes(kw.slice(0, 2))) score += 4;
    });
    if (/背景|旨在|目的|意义/.test(s) && !/参与|获得|可以|申请|办理/.test(s)) score -= 6;
    if (/^\d+[\u4e00-\u9fa5]{0,4}[：:]/.test(s)) score += 2;
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
      if (picked.length >= 2) break;
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
    text = stripFormalOpenings(stripBoilerplate(text));
    text = normalizePunctuation(text);
    text = stripCategoryTagsFromAnswer(text);
    text = oralizeFormalPhrases(text);

    const plainLen = text.replace(/\s/g, '').length;
    if (!text) return '';
    if (plainLen <= maxLen && !isOverlyFormal(text)) return text;

    let condensed = condenseForVoice(text, maxLen, question);
    condensed = oralizeFormalPhrases(stripFormalOpenings(condensed));

    if (condensed && !isOverlyFormal(condensed)) {
      return enforceTurnLength(condensed, maxLen, 0);
    }

    // 仍偏书面：再压一轮，只留与问题最相关的 1 句
    const keywords = extractQuestionKeywords(question);
    const best = splitIntoClauses(text)
      .sort((a, b) => scoreClauseForQuestion(b, keywords) - scoreClauseForQuestion(a, keywords))[0];
    if (best) {
      condensed = oralizeFormalPhrases(stripFormalOpenings(best));
      return enforceTurnLength(condensed, maxLen, 0);
    }

    const fallback = oralizeFormalPhrases(stripFormalOpenings(truncateAtSentence(text, maxLen * 2)));
    return enforceTurnLength(fallback || text.slice(0, maxLen), maxLen, 0);
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
      .replace(/详见/g, '您可以了解')
      .replace(/点击/g, '联系')
      .replace(/查看/g, '了解')
      .replace(/扫码/g, '操作')
      .replace(/登录/g, '进入')
      .replace(/官方网站|官方平台/g, '官网')
      .replace(/授权代理商\/门店/g, '授权门店')
      .replace(/温馨提示[：:，,]?/g, '')
      .replace(/请注意[：:，,]?/g, '')
      .replace(/也就是说[，,]?/g, '')
      .replace(/尊敬的用户[，,]?/g, '')
      .replace(/亲爱的用户[，,]?/g, '')
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
    const needsDeep = entry.hasHtml || plainTextLength(rawAnswer) > maxLen * 1.2 || isOverlyFormal(stripHtml(rawAnswer));

    let answer;
    if (needsDeep) {
      answer = deepVoiceifyAnswer(question, rawAnswer, maxLen);
    } else {
      answer = oralizeDocumentStructure(rawAnswer);
      answer = stripFormalOpenings(answer);
      answer = normalizePunctuation(answer);
      answer = stripCategoryTagsFromAnswer(answer);
      answer = oralizeFormalPhrases(answer);
      answer = stripBoilerplate(answer);
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
      let t = stripBoilerplate(stripFormalOpenings(turn));
      const ordinals = (t.match(/第[一二三四五六七八九十\d]+，/g) || []).length;
      const sentences = t.split(/[。；]/).filter(s => s.trim().length > 4).length;
      if (t.length > maxLen || ordinals > 1 || sentences > 2 || isOverlyFormal(t)) {
        t = condenseForVoice(t, maxLen, question);
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
    normalizePunctuation,
    oralizeNumbers,
    oralizeDocumentStructure,
    stripFormalOpenings,
    oralizeFormalPhrases,
    stripBoilerplate,
    condenseForVoice,
    deepVoiceifyAnswer,
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

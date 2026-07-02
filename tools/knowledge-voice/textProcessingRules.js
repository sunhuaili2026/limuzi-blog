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
    let result = text.replace(/<\/?(h[1-6]|p|div|br|li|tr|td|th)[^>]*>/gi, '\n');
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

    // 无编号的章节小标题
    result = result.replace(
      /(?:^|\n)\s*(?:活动背景|活动规则|活动详情|活动内容|参与方式|适用条件|注意事项|温馨提示|申请条件|办理流程|所需材料)[：:：]?\s*/g,
      ' '
    );

    // 编号列表 → 第一，第二，（含 "1. 活动背景" 这类）
    result = result.replace(/(?:^|\n|\s)(\d{1,2})[.．、)）]\s*(?:活动背景|活动规则|活动详情|活动内容|参与方式|适用条件|注意事项|温馨提示|申请条件|办理流程|所需材料)?[：:：]?\s*/g, (_, num) => {
      return ` ${ordinalLabel(+num)}，`;
    });

    // 无序列表符
    result = result.replace(/[•·●○◆▪-]\s+/g, '，');

    // 合并空白，去掉空行
    result = result.replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return result;
  }

  /** 书面语 → 播报口语（Layer1 确定性改写） */
  function oralizeFormalPhrases(text) {
    return (text || '')
      .replace(/该商品/g, '这款产品')
      .replace(/上述/g, '')
      .replace(/如下/g, '')
      .replace(/详见/g, '您可以了解')
      .replace(/点击/g, '联系')
      .replace(/查看/g, '了解')
      .replace(/扫码/g, '操作')
      .replace(/登录/g, '进入')
      .replace(/官方网站/g, '官网')
      .replace(/温馨提示[：:，,]?/g, '')
      .replace(/请注意[：:，,]?/g, '')
      .replace(/也就是说[，,]?/g, '')
      .replace(/[（(]详见[^）)]*[）)]/g, '');
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

  function ensureCategoryPath(path, prefix, depth) {
    let result = (path || '通用知识').replace(/\s+/g, '');
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
    return stripHtml(rawText).replace(/\r/g, '').trim();
  }

  function applyLayer1ToEntry(entry, config) {
    const maxLen = config.maxAnswerLength || 120;
    const maxTurns = config.maxAnswerTurns || 5;
    let answer = oralizeDocumentStructure(entry.answer || '');
    answer = normalizePunctuation(answer);
    answer = stripCategoryTagsFromAnswer(answer);
    answer = oralizeFormalPhrases(answer);
    answer = oralizeNumbers(answer);

    let standardQuestion = normalizePunctuation(entry.question || entry.standardQuestion || '');
    standardQuestion = oralizeFormalPhrases(standardQuestion).slice(0, 200);
    const intentTag = entry.intentTag || extractCategoryTag(entry.answer || entry.summary || '');

    if (!answer || isCategoryTagOnly(answer)) {
      const fallback = stripCategoryTagsFromAnswer(stripHtml(entry.sourceExcerpt || ''));
      if (fallback && !isCategoryTagOnly(fallback)) answer = fallback;
    }

    const answerTurns = splitAnswerTurns(answer, maxLen, maxTurns);
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
    oralizeFormalPhrases,
    splitMultiEntity,
    truncateAtSentence,
    splitAnswerTurns,
    detectSensitive,
    ensureCategoryPath,
    isCategoryTagOnly,
    stripCategoryTagsFromAnswer,
    extractCategoryTag,
    preprocessText,
    applyLayer1ToEntry,
    chunkText,
    SENSITIVE_KEYWORDS
  };
})(window);

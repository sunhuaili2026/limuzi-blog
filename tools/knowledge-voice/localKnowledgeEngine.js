/** 内置规则引擎 — 本地拆解 / 语音化 / 去重 / 相似问（优先于 LLM） */
(function (global) {
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
    let a = answer.trim();
    const intentTag = R.extractCategoryTag(a) || R.extractCategoryTag(q);
    a = R.stripCategoryTagsFromAnswer(a);
    if (!q || !a || q.length < 2 || a.length < 1) return;
    if (R.isCategoryTagOnly(a)) return;
    if (/^第\s*\d+\s*页$/.test(q) || /^目录$/.test(q)) return;

    list.push({
      category,
      question: ensureQuestion(q),
      answer: a,
      intentTag,
      keywords: extractKeywords(q + a),
      sourceExcerpt: a.slice(0, 200),
      isComplex: R.detectSensitive(q + a) || a.length > 600 || /<[^>]+>/.test(answer),
      rawAnswerLength: a.length,
      hasHtml: /<[^>]+>/.test(answer)
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
      isComplex: f.isComplex
    }));
  }

  /** Phase 2 内置语音化 — Layer1 + 轻量口语模板 */
  function localVoiceifyFindings(findings, config) {
    return findings.map(f => {
      const entry = R.applyLayer1ToEntry({
        categoryPath: f.categoryPath,
        question: f.question,
        answer: f.answer,
        keywords: f.keywords,
        sourceExcerpt: f.sourceExcerpt
      }, config);

      entry.answerTurns = entry.answerTurns.map((turn, i) => oralizeAnswerTone(turn, i === 0, config));
      if (!entry.standardQuestion.match(/[？?]$/)) {
        entry.standardQuestion = ensureQuestion(entry.standardQuestion);
      }
      return entry;
    });
  }

  function oralizeAnswerTone(answer, isFirstTurn, config) {
    const maxLen = config?.maxAnswerLength || 120;
    let a = R.stripFormalOpenings(answer || '');
    if (!a) return a;
    a = R.oralizeFormalPhrases(a);
    const prefixReserve = isFirstTurn && a.length > 8 ? 3 : 0;
    a = R.enforceTurnLength(a, maxLen, prefixReserve);
    if (isFirstTurn && prefixReserve && !/^(您好|你好)/.test(a)) {
      a = '您好，' + a.replace(/^[，,]/, '');
    }
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

  function needsLLMVoiceify(entry) {
    if (entry.isComplex) return true;
    if (entry.hasHtml && (entry.rawAnswerLength || 0) > 80) return true;
    if ((entry.rawAnswerLength || 0) > 250) return true;
    return (entry.answerTurns || []).some(t => t.length > 200);
  }

  global.KVLocalEngine = {
    localExtractFindings,
    localVoiceifyFindings,
    localDedupEntries,
    localGenerateSimilarQuestions,
    needsLLMExtraction,
    needsLLMVoiceify,
    buildStats
  };
})(window);

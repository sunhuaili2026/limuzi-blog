/** 主流程编排 — 内置规则优先，LLM 可选增强 */
(function (global) {
  const { preprocessText, applyLayer1ToEntry, chunkText, ensureCategoryPath } = global.KVTextRules;
  const { buildExtractPrompt, buildVoiceifyPrompt, buildDedupPrompt, buildSimilarQuestionsPrompt } = global.KVPrompts;
  const Local = global.KVLocalEngine;

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
    const localFindings = Local.localExtractFindings(text, config);

    if (!config.enableLLMEnhance || !Local.needsLLMExtraction(text, localFindings)) {
      onProgress?.({
        phase: 'extracting',
        message: `内置规则提取完成（${localFindings.length} 条）`
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
        message: `AI 补充提取 (${i + 1}/${chunks.length})...`
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
    onProgress?.({ phase: 'voiceifying', message: '内置规则语音化改写中...' });
    let entries = Local.localVoiceifyFindings(findings, config);

    if (!config.enableLLMEnhance) {
      onProgress?.({
        phase: 'voiceifying',
        message: `内置规则语音化完成（${entries.length} 条）`
      });
      return entries;
    }

    const complex = findings.filter((f, i) => Local.needsLLMVoiceify({
      ...f,
      answerTurns: entries[i]?.answerTurns
    }));

    if (!complex.length) return entries;

    onProgress?.({
      phase: 'voiceifying',
      message: `AI 增强改写复杂条目 (${complex.length} 条)...`
    });

    const batchSize = 8;
    for (let i = 0; i < complex.length; i += batchSize) {
      const batch = complex.slice(i, i + batchSize);
      try {
        const prompt = buildVoiceifyPrompt(config, batch);
        const content = await callLLM([{ role: 'user', content: prompt }]);
        const parsed = safeJsonParse(content);
        (parsed.entries || []).forEach(e => {
          const idx = entries.findIndex(x => x.standardQuestion === e.standardQuestion);
          const refined = applyLayer1ToEntry({
            categoryPath: e.categoryPath,
            question: e.standardQuestion,
            answer: (e.answerTurns || []).join(''),
            summary: e.summary,
            keywords: e.keywords,
            sourceExcerpt: e.sourceExcerpt
          }, config);
          const merged = {
            ...refined,
            standardQuestion: e.standardQuestion || refined.standardQuestion,
            summary: e.summary || refined.summary,
            answerTurns: e.answerTurns?.length ? e.answerTurns : refined.answerTurns,
            needsHuman: e.needsHuman || refined.needsHuman
          };
          if (idx >= 0) entries[idx] = merged;
          else entries.push(merged);
        });
      } catch (e) {
        console.warn('LLM voiceify batch failed', e);
      }
      await sleep(400);
    }

    return entries;
  }

  async function phase3Dedup(entries, config, onProgress) {
    onProgress?.({ phase: 'deduplicating', message: '内置规则去重审核中...' });
    const localResult = Local.localDedupEntries(entries, config);

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
        stats: parsed.stats || Local.buildStats(deduped)
      };
    } catch {
      return localResult;
    }
  }

  async function phase5SimilarQuestions(entries, config, onProgress) {
    if (!config.generateSimilarQuestions) return [];

    onProgress?.({ phase: 'generating_similar', message: '内置规则生成相似问...' });
    const localSimilar = Local.localGenerateSimilarQuestions(entries, config);

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

    return {
      companyName: config.companyName,
      entries,
      similarQuestions,
      audit: dedupResult.audit,
      stats,
      warnings: []
    };
  }

  async function parseUploadedFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      return await file.text();
    }
    if (name.endsWith('.csv')) {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const rows = fileToRows(text);
      if (isPlatformTemplateRows(rows)) return parsePlatformXlsxRows(rows);
      return parseStructuredRows(rows);
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载，无法解析 Excel');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets['问答知识'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (isPlatformTemplateRows(rows)) return parsePlatformXlsxRows(rows);
      return parseStructuredRows(rows);
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

  const QUESTION_HEADERS = ['标准问', '问题', '问句', '用户问题', '提问', 'question', 'query', 'faq_question', 'std_question', 'title'];
  const ANSWER_HEADERS = ['答案内容', '答案', '内容', '回复', '解答', 'answer', 'content', 'response', 'faq_answer', 'reply', 'answer_content', '简介内容'];
  const CATEGORY_HEADERS = ['所属目录', '目录', '分类', 'category', 'path', '所属分类', '知识目录', '品类', '类目'];
  const SKIP_HEADERS = ['id', '_id', 'uuid', 'question_id', 'answer_id', 'category_id', 'parent_id', 'workflow_id', 'created_at', 'updated_at', 'create_time', 'update_time', 'deleted', 'status', 'type'];

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

  function detectColumnMapping(headerRow) {
    const headers = (headerRow || []).map(normalizeHeaderName);
    const mapping = { category: -1, question: -1, answer: -1, summary: -1 };
    headers.forEach((h, idx) => {
      if (!h || SKIP_HEADERS.some(skip => h === skip || h.endsWith('_' + skip) || h.includes('_id'))) return;
      if (mapping.question < 0 && QUESTION_HEADERS.some(k => h === k.toLowerCase() || h.includes(k.toLowerCase()))) {
        mapping.question = idx;
      }
      if (mapping.answer < 0 && ANSWER_HEADERS.some(k => h === k.toLowerCase() || h.includes(k.toLowerCase()))) {
        mapping.answer = idx;
      }
      if (mapping.category < 0 && CATEGORY_HEADERS.some(k => h === k.toLowerCase() || h.includes(k.toLowerCase()))) {
        mapping.category = idx;
      }
      if (mapping.summary < 0 && (h.includes('简介') || h === 'summary' || h === 'desc' || h === 'description')) {
        mapping.summary = idx;
      }
    });
    return mapping;
  }

  function columnStats(samples) {
    const values = samples.map(v => String(v ?? '').trim()).filter(Boolean);
    if (!values.length) return { count: 0, avgLen: 0, idRatio: 1, questionRatio: 0, answerRatio: 0 };
    const avgLen = values.reduce((n, v) => n + v.length, 0) / values.length;
    const idRatio = values.filter(isSnowflakeId).length / values.length;
    const questionRatio = values.filter(v =>
      isValidQuestion(v) && (/[？?]/.test(v) || /^(如何|怎么|什么|哪些|是否|能否|可以|多少|为什么|哪里|哪个|请问)/.test(v))
    ).length / values.length;
    const answerRatio = values.filter(v => isValidAnswer(v) && v.length >= 8).length / values.length;
    return { count: values.length, avgLen, idRatio, questionRatio, answerRatio };
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
        categoryScore: (stats.avgLen > 1 && stats.avgLen < 30 ? 1.5 : 0) + (stats.idRatio < 0.2 ? 0.5 : -2) - stats.questionRatio
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

    let category = byCategory.find(s => s.col !== question && s.col !== answer && s.stats.idRatio < 0.2)?.col ?? -1;
    if (category < 0 && question > 0) category = 0;

    return { category, question, answer, summary: -1 };
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
  function parseStructuredRows(rows) {
    const R = global.KVTextRules;
    const cleanRows = (rows || []).filter(r => r && r.some(c => String(c ?? '').trim()));
    if (!cleanRows.length) throw new Error('CSV/表格解析失败：文件为空');

    const headerIdx = findHeaderRowIndex(cleanRows);
    const headerRow = cleanRows[headerIdx] || [];
    let mapping = detectColumnMapping(headerRow);
    const dataRows = cleanRows.slice(headerIdx + 1);

    if (mapping.question < 0 || mapping.answer < 0) {
      mapping = inferColumnsByContent(dataRows.length ? dataRows : cleanRows);
    }
    if (mapping.question < 0 || mapping.answer < 0) {
      throw new Error('无法识别 CSV 中的「问题」和「答案」列。请确认文件包含标准问/答案字段，或改用平台 xlsx 模板。');
    }

    const blocks = [];
    dataRows.forEach(row => {
      const cells = (row || []).map(c => String(c ?? '').trim());
      if (!cells.some(Boolean)) return;

      const question = cells[mapping.question] || '';
      let answer = cells[mapping.answer] || '';
      const category = mapping.category >= 0 ? (cells[mapping.category] || '') : '';
      const summary = mapping.summary >= 0 ? (cells[mapping.summary] || '') : '';

      if (!isValidQuestion(question)) return;
      if (!isValidAnswer(answer)) {
        if (isValidAnswer(summary)) answer = summary;
        else return;
      }
      if (R.isCategoryTagOnly(answer)) return;

      blocks.push({
        cat: category || '通用',
        q: question,
        summary,
        answers: [answer]
      });
    });

    const text = blocks.map(b => {
      let fullAnswer = b.answers.join('').trim();
      fullAnswer = R.stripCategoryTagsFromAnswer(fullAnswer);
      if (!fullAnswer && b.summary && !R.isCategoryTagOnly(b.summary) && b.summary.length > 8) {
        fullAnswer = R.stripCategoryTagsFromAnswer(b.summary);
      }
      if (!fullAnswer || !isValidAnswer(fullAnswer)) return '';
      let block = `【${b.cat || '通用'}】\n问：${b.q}\n答：${fullAnswer}`;
      const tag = R.extractCategoryTag(b.summary);
      if (tag) block += `\n分类：${tag}`;
      return block;
    }).filter(Boolean).join('\n\n');

    if (!text) {
      throw new Error('CSV 解析结果为空：未找到有效的问答内容。数据库导出请确认含「标准问/问题」与「答案/内容」列，且答案不是纯数字 ID。');
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
      let block = `【${b.cat || '通用'}】\n问：${b.q}\n答：${fullAnswer}`;
      if (tag) block += `\n分类：${tag}`;
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
    parsePlatformXlsxRows,
    parseStructuredRows,
    safeJsonParse
  };
})(window);

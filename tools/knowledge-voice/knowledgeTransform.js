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
        message: 'AI 大模型逐条精修中 (' + (i + 1) + '/' + toProcess.length + ')...',
        current: i + 1,
        total: toProcess.length
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
      llmCandidates
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

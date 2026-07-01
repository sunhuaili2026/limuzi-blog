/** 主流程编排 — knowledgeTransformService */
(function (global) {
  const { preprocessText, applyLayer1ToEntry, chunkText, ensureCategoryPath } = global.KVTextRules;
  const { buildExtractPrompt, buildVoiceifyPrompt, buildDedupPrompt, buildSimilarQuestionsPrompt } = global.KVPrompts;

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
    const preprocessed = preprocessText(text, config);
    const chunks = chunkText(preprocessed);
    const allFindings = [];

    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({
        phase: 'extracting',
        currentChunk: i + 1,
        totalChunks: chunks.length,
        message: `正在提取知识条目 (${i + 1}/${chunks.length})...`
      });

      const prompt = buildExtractPrompt(config, chunks[i], i, chunks.length);
      const content = await callLLM([
        { role: 'user', content: prompt }
      ]);
      const parsed = safeJsonParse(content);
      (parsed.findings || []).forEach(f => allFindings.push(rawToFinding(f, config)));
      if (i < chunks.length - 1) await sleep(800);
    }

    return allFindings;
  }

  async function phase2Voiceify(findings, config, onProgress) {
    const batchSize = 8;
    const entries = [];

    for (let i = 0; i < findings.length; i += batchSize) {
      const batch = findings.slice(i, i + batchSize);
      onProgress?.({
        phase: 'voiceifying',
        currentChunk: Math.floor(i / batchSize) + 1,
        totalChunks: Math.ceil(findings.length / batchSize),
        processedEntries: entries.length,
        message: `正在语音化改写 (${Math.min(i + batchSize, findings.length)}/${findings.length})...`
      });

      const layer1Batch = batch.map(f => applyLayer1ToEntry({
        categoryPath: f.categoryPath,
        question: f.question,
        answer: f.answer,
        keywords: f.keywords,
        sourceExcerpt: f.sourceExcerpt
      }, config));

      try {
        const prompt = buildVoiceifyPrompt(config, batch);
        const content = await callLLM([{ role: 'user', content: prompt }]);
        const parsed = safeJsonParse(content);
        if (parsed.entries?.length) {
          parsed.entries.forEach(e => {
            const refined = applyLayer1ToEntry({
              categoryPath: e.categoryPath,
              question: e.standardQuestion,
              answer: (e.answerTurns || []).join(''),
              summary: e.summary,
              keywords: e.keywords,
              sourceExcerpt: e.sourceExcerpt
            }, config);
            entries.push({
              ...refined,
              standardQuestion: e.standardQuestion || refined.standardQuestion,
              summary: e.summary || refined.summary,
              answerTurns: e.answerTurns?.length ? e.answerTurns : refined.answerTurns,
              needsHuman: e.needsHuman || refined.needsHuman,
              transferReason: e.transferReason || refined.transferReason
            });
          });
        } else {
          entries.push(...layer1Batch);
        }
      } catch {
        entries.push(...layer1Batch);
      }

      await sleep(600);
    }

    return entries;
  }

  async function phase3Dedup(entries, config, onProgress) {
    onProgress?.({ phase: 'deduplicating', message: '正在去重审核...' });

    if (entries.length <= 1) {
      return {
        entries,
        audit: { removedCount: 0, mergedCount: 0, conflicts: [] },
        stats: buildStats(entries)
      };
    }

    try {
      const prompt = buildDedupPrompt(config, entries);
      const content = await callLLM([
        { role: 'user', content: prompt }
      ], 'deepseek-chat');
      const parsed = safeJsonParse(content);
      const deduped = parsed.entries?.length ? parsed.entries.map(e => applyLayer1ToEntry({
        categoryPath: e.categoryPath,
        question: e.standardQuestion,
        answer: (e.answerTurns || []).join(''),
        summary: e.summary,
        keywords: e.keywords,
        sourceExcerpt: e.sourceExcerpt
      }, config)).map((e, idx) => ({
        ...e,
        standardQuestion: parsed.entries[idx].standardQuestion || e.standardQuestion,
        summary: parsed.entries[idx].summary || e.summary,
        answerTurns: parsed.entries[idx].answerTurns || e.answerTurns,
        needsHuman: parsed.entries[idx].needsHuman ?? e.needsHuman,
        conflict: parsed.entries[idx].conflict ?? false
      })) : entries;

      return {
        entries: deduped,
        audit: {
          removedCount: parsed.removedCount || 0,
          mergedCount: parsed.mergedCount || 0,
          conflicts: parsed.conflicts || []
        },
        stats: parsed.stats || buildStats(deduped)
      };
    } catch {
      return {
        entries,
        audit: { removedCount: 0, mergedCount: 0, conflicts: [] },
        stats: buildStats(entries)
      };
    }
  }

  async function phase5SimilarQuestions(entries, config, onProgress) {
    if (!config.generateSimilarQuestions) return [];

    onProgress?.({ phase: 'generating_similar', message: '正在生成相似问...' });

    try {
      const prompt = buildSimilarQuestionsPrompt(config, entries);
      const content = await callLLM([{ role: 'user', content: prompt }]);
      const parsed = safeJsonParse(content);
      return parsed.similarQuestions || [];
    } catch {
      return entries.slice(0, 20).map(e => ({
        categoryPath: e.categoryPath,
        standardQuestion: e.standardQuestion,
        type: '用户相似问',
        phrases: [e.standardQuestion.replace(/[？?]$/, ''), '请问' + e.standardQuestion.slice(0, 12)]
      }));
    }
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

  async function transformKnowledgeToVoice(rawText, config, onProgress) {
    const start = Date.now();

    onProgress?.({ phase: 'parsing', message: '正在解析文件结构...' });
    await sleep(300);

    const findings = await phase1Extract(rawText, config, onProgress);
    if (!findings.length) {
      throw new Error('未能从输入中提取到知识条目，请检查内容格式');
    }

    let entries = await phase2Voiceify(findings, config, onProgress);
    const dedupResult = await phase3Dedup(entries, config, onProgress);
    entries = dedupResult.entries;

    const similarQuestions = await phase5SimilarQuestions(entries, config, onProgress);

    onProgress?.({ phase: 'exporting', message: '转换完成，可预览并导出' });

    const stats = {
      ...dedupResult.stats,
      totalSourceDocs: 1,
      totalSimilarQuestions: similarQuestions.reduce((n, sq) => n + (sq.phrases?.length || 0), 0),
      processingTimeMs: Date.now() - start
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
      const text = await file.text();
      return text.split('\n').slice(1).map(line => {
        const [category, question, answer] = line.split(',');
        return `【${category || '通用'}】\n问：${question}\n答：${answer}`;
      }).join('\n\n');
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载，无法解析 Excel');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets['问答知识'] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const dataRows = rows.slice(3);
      return dataRows.map(row => {
        const [cat, q, , summary, , answer] = row;
        if (!q && !answer) return '';
        return `【${cat || '通用'}】\n问：${q}\n答：${answer || summary}`;
      }).filter(Boolean).join('\n\n');
    }
    throw new Error('不支持的文件格式，请上传 .txt / .md / .csv / .xlsx');
  }

  global.KVTransform = {
    transformKnowledgeToVoice,
    parseUploadedFile,
    safeJsonParse
  };
})(window);

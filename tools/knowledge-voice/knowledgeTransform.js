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
      return parsePlatformXlsxRows(rows);
    }
    throw new Error('不支持的文件格式，请上传 .txt / .md / .csv / .xlsx');
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
    safeJsonParse
  };
})(window);

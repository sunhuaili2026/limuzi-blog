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

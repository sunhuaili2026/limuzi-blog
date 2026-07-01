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

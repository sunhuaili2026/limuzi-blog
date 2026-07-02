#!/bin/bash
# 合并知识库语音化模块为单文件，避免多脚本加载失败
set -e
cd "$(dirname "$0")"
OUT=kv-bundle.js
echo "/* KV Bundle - $(date -u +%Y-%m-%dT%H:%M:%SZ) */" > "$OUT"
for f in textProcessingRules.js localKnowledgeEngine.js knowledgeTransformPrompts.js platformExport.js knowledgeTransform.js; do
  echo "/* --- $f --- */" >> "$OUT"
  cat "$f" >> "$OUT"
  echo "" >> "$OUT"
done
node --check "$OUT"
echo "Built $OUT ($(wc -c < "$OUT") bytes)"

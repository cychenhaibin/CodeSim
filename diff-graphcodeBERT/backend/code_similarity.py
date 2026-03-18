"""
基于 GraphCodeBERT 的代码语义相似度检测

完整实现流程：
1. 提取数据流图(DFG) - 记录变量之间的"值从何处来"的依赖关系
2. 代码预处理（去注释、分词等）
3. 将代码tokens + DFG 输入GraphCodeBERT编码器
4. 获取代码向量表示
5. 计算向量相似度（余弦相似度）

参考: https://www.cnblogs.com/theseventhson/p/18211242
模型: https://huggingface.co/microsoft/graphcodebert-base
官方代码: https://github.com/microsoft/CodeBERT/tree/master/GraphCodeBERT
"""

import torch
import numpy as np
import re
from transformers import RobertaTokenizer, RobertaModel
from sklearn.metrics.pairwise import cosine_similarity
from typing import List, Tuple, Dict, Optional, Any

from parser import TreeSitterDFGExtractor
from parser.utils import remove_comments_and_docstrings
from code_normalizer import normalize_code


# ============================================================================
# 主要的代码相似度检测器
# ============================================================================

class CodeSimilarityDetector:
    """
    代码相似度检测器，基于 GraphCodeBERT
    
    完整流程：
    1. 提取数据流图(DFG)
    2. 代码预处理（去注释、分词）
    3. 编码为向量
    4. 计算余弦相似度
    """
    
    def __init__(self, model_name: str = "microsoft/graphcodebert-base"):
        """
        初始化检测器
        
        Args:
            model_name: 模型名称或本地路径，默认使用 microsoft/graphcodebert-base
        """
        print(f"正在加载模型: {model_name}")
        self.tokenizer = RobertaTokenizer.from_pretrained(model_name)
        self.model = RobertaModel.from_pretrained(model_name)
        self.model.eval()  # 设置为评估模式
        
        # DFG 提取器
        self.dfg_extractors = {}
        
        print("模型加载完成!")
    
    def _get_dfg_extractor(self, lang: str) -> TreeSitterDFGExtractor:
        """获取指定语言的DFG提取器"""
        if lang not in self.dfg_extractors:
            self.dfg_extractors[lang] = TreeSitterDFGExtractor(lang)
        return self.dfg_extractors[lang]
    
    def preprocess_code(self, code: str, lang: str = 'c', do_normalize: bool = True) -> Tuple[str, List[str], List[Tuple]]:
        """
        预处理代码：标准化 → 去注释 → 分词 → 提取DFG
        
        Args:
            code: 源代码字符串
            lang: 编程语言
            do_normalize: 是否做标准化预处理（移除调试语句、CSS值归一化、变量名归一化）
            
        Returns:
            (清理后的代码, code_tokens, dfg)
        """
        # 步骤0: 标准化预处理
        if do_normalize:
            code = normalize_code(code, lang)
        
        # 步骤1: 去除注释和文档字符串
        cleaned_code = remove_comments_and_docstrings(code, lang)
        
        # 步骤2: 提取DFG
        dfg_extractor = self._get_dfg_extractor(lang)
        code_tokens, dfg = dfg_extractor.get_dfg_tokens(cleaned_code)
        
        return cleaned_code, code_tokens, dfg
    
    def encode_code(self, code: str, lang: str = 'c') -> np.ndarray:
        """
        将代码片段编码为向量
        
        完整流程：
        1. 预处理代码（去注释、提取DFG）
        2. 通过 tokenizer 转换为 token 序列
        3. 输入 GraphCodeBERT 模型
        4. 提取最后一层 hidden state 的输出
        5. 对所有 token 的向量取平均
        
        Args:
            code: 代码片段字符串
            lang: 编程语言
            
        Returns:
            代码的向量表示 (numpy array)
        """
        # 预处理
        cleaned_code, code_tokens, dfg = self.preprocess_code(code, lang)
        
        # 构建输入
        # GraphCodeBERT 的输入格式: [CLS] code_tokens [SEP] dfg_info [SEP]
        # 这里简化处理，将DFG信息编码为特殊格式附加到代码后
        dfg_str = self._dfg_to_string(dfg)
        
        # 组合代码和DFG信息
        if dfg_str:
            combined_input = f"{cleaned_code}\n{dfg_str}"
        else:
            combined_input = cleaned_code
        
        # tokenize
        inputs = self.tokenizer(
            combined_input, 
            return_tensors='pt', 
            max_length=512, 
            truncation=True, 
            padding='max_length'
        )
        
        # 编码
        with torch.no_grad():
            outputs = self.model(**inputs)
            last_hidden_state = outputs.last_hidden_state
            
            # 使用 [CLS] token 的向量（位置0），这是 BERT 类模型推荐的序列表示方式
            # 相比 mean pooling，[CLS] 更能捕获整体语义差异
            cls_vector = last_hidden_state[:, 0, :].squeeze()
            
            # 同时计算有效 token 的 mean（排除 padding）
            attention_mask = inputs['attention_mask']
            mask_expanded = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
            sum_embeddings = torch.sum(last_hidden_state * mask_expanded, 1)
            sum_mask = torch.clamp(mask_expanded.sum(1), min=1e-9)
            mean_vector = (sum_embeddings / sum_mask).squeeze()
            
            # 结合 CLS 和 mean（CLS 权重更高，更敏感于差异）
            vector = 0.7 * cls_vector + 0.3 * mean_vector
            
        return vector.numpy()
    
    def _dfg_to_string(self, dfg: List[Tuple]) -> str:
        """
        将DFG转换为字符串表示
        
        Args:
            dfg: 数据流图边列表
            
        Returns:
            DFG的字符串表示
        """
        if not dfg:
            return ""
        
        # 将DFG边转换为可读格式
        edges = []
        for item in dfg:
            if len(item) >= 4:
                var_name, idx, edge_type, deps = item[0], item[1], item[2], item[3]
                if deps:
                    edges.append(f"{var_name}:{edge_type}:{','.join(map(str, deps))}")
        
        return " ".join(edges[:50])  # 限制DFG字符串长度
    
    def calculate_similarity(self, code1: str, code2: str, lang: str = 'c') -> dict:
        """
        计算两个代码片段的语义相似度
        
        Args:
            code1: 第一个代码片段
            code2: 第二个代码片段
            lang: 编程语言
            
        Returns:
            包含校准相似度和中间变量的字典
        """
        vector1 = self.encode_code(code1, lang)
        vector2 = self.encode_code(code2, lang)
        
        # 计算余弦相似度
        raw_similarity = cosine_similarity([vector1], [vector2])[0][0]
        
        # 计算文本级别的差异作为校准因子
        text_similarity = self._calculate_text_similarity(code1, code2)
        
        # 校准：如果文本差异很大，降低语义相似度
        # 使用几何平均来平衡两者
        calibrated_similarity = (raw_similarity * text_similarity) ** 0.5
        
        # 如果文本相似度很低（<0.3），进一步惩罚
        if text_similarity < 0.3:
            calibrated_similarity *= (0.5 + text_similarity)
        
        final_similarity = float(max(0, min(1, calibrated_similarity)))
        
        return {
            "similarity": final_similarity,
            "raw_cosine_similarity": float(raw_similarity),
            "text_similarity": float(text_similarity),
        }
    
    def _calculate_text_similarity(self, code1: str, code2: str) -> float:
        """
        计算文本级别的相似度（用于校准）
        
        使用 Jaccard 相似度计算 token 集合的重叠程度
        """
        # 简单分词
        tokens1 = set(re.findall(r'\b\w+\b', code1.lower()))
        tokens2 = set(re.findall(r'\b\w+\b', code2.lower()))
        
        if not tokens1 or not tokens2:
            return 0.0
        
        intersection = len(tokens1 & tokens2)
        union = len(tokens1 | tokens2)
        
        return intersection / union if union > 0 else 0.0
    
    def batch_encode(self, codes: List[str], lang: str = 'c') -> np.ndarray:
        """
        批量编码多个代码片段
        
        Args:
            codes: 代码片段列表
            lang: 编程语言
            
        Returns:
            向量矩阵，形状为 (n_codes, hidden_size)
        """
        vectors = []
        for code in codes:
            vector = self.encode_code(code, lang)
            vectors.append(vector)
        return np.array(vectors)
    
    def _encode_single_window(self, text: str):
        """编码单个 512 窗口，返回 (cls_vector, mean_vector, combined_vector, effective_tokens)"""
        inputs = self.tokenizer(
            text,
            return_tensors='pt',
            max_length=512,
            truncation=True,
            padding='max_length'
        )
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            last_hidden_state = outputs.last_hidden_state
            
            cls_vector = last_hidden_state[:, 0, :].squeeze()
            
            attention_mask = inputs['attention_mask']
            mask_expanded = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
            sum_embeddings = torch.sum(last_hidden_state * mask_expanded, 1)
            sum_mask = torch.clamp(mask_expanded.sum(1), min=1e-9)
            mean_vector = (sum_embeddings / sum_mask).squeeze()
            
            combined = 0.7 * cls_vector + 0.3 * mean_vector
            effective = int(attention_mask.sum().item())
        
        return cls_vector, mean_vector, combined, effective

    def encode_ast_sbt(self, sbt_string: str, return_debug: bool = False):
        """
        将 AST 的 SBT 序列化字符串编码为向量（支持滑动窗口处理超长输入）
        
        当 BPE token 数超过 512 时，使用滑动窗口将 SBT 分段编码后平均，
        确保整棵 AST 结构都被模型看到。
        
        Args:
            sbt_string: AST 的 SBT 序列化字符串
            return_debug: 是否返回中间向量的调试信息
        """
        token_ids = self.tokenizer.encode(sbt_string, add_special_tokens=False)
        total_bpe_tokens = len(token_ids)
        
        window_size = 510  # 留 2 个位置给 [CLS] 和 [SEP]
        stride = 256
        
        if total_bpe_tokens <= window_size:
            cls_vec, mean_vec, combined, effective = self._encode_single_window(sbt_string)
            if return_debug:
                debug = {
                    "cls_norm": float(torch.norm(cls_vec).item()),
                    "mean_norm": float(torch.norm(mean_vec).item()),
                    "combined_norm": float(torch.norm(combined).item()),
                    "bpe_tokens": total_bpe_tokens,
                    "windows": 1,
                }
                return combined.numpy(), debug
            return combined.numpy()
        
        # 滑动窗口：分段编码
        all_combined = []
        all_cls = []
        all_mean = []
        
        start = 0
        while start < total_bpe_tokens:
            end = min(start + window_size, total_bpe_tokens)
            chunk_ids = token_ids[start:end]
            chunk_text = self.tokenizer.decode(chunk_ids, skip_special_tokens=True)
            
            cls_vec, mean_vec, combined, _ = self._encode_single_window(chunk_text)
            all_combined.append(combined)
            all_cls.append(cls_vec)
            all_mean.append(mean_vec)
            
            if end >= total_bpe_tokens:
                break
            start += stride
        
        n_windows = len(all_combined)
        avg_combined = torch.stack(all_combined).mean(dim=0)
        avg_cls = torch.stack(all_cls).mean(dim=0)
        avg_mean = torch.stack(all_mean).mean(dim=0)
        
        if return_debug:
            debug = {
                "cls_norm": float(torch.norm(avg_cls).item()),
                "mean_norm": float(torch.norm(avg_mean).item()),
                "combined_norm": float(torch.norm(avg_combined).item()),
                "bpe_tokens": total_bpe_tokens,
                "windows": n_windows,
            }
            return avg_combined.numpy(), debug
        
        return avg_combined.numpy()
    
    def calculate_ast_similarity(self, sbt1: str, sbt2: str, return_debug: bool = False):
        """
        计算两个 AST (SBT格式) 的相似度
        
        Args:
            sbt1: 第一个 AST 的 SBT 字符串
            sbt2: 第二个 AST 的 SBT 字符串
            return_debug: 是否返回中间向量调试信息
            
        Returns:
            return_debug=False: float 相似度
            return_debug=True: dict 包含 similarity 和向量调试信息
        """
        if return_debug:
            vector1, debug1 = self.encode_ast_sbt(sbt1, return_debug=True)
            vector2, debug2 = self.encode_ast_sbt(sbt2, return_debug=True)
        else:
            vector1 = self.encode_ast_sbt(sbt1)
            vector2 = self.encode_ast_sbt(sbt2)
        
        similarity = cosine_similarity([vector1], [vector2])[0][0]
        similarity = float(max(0, min(1, similarity)))
        
        if return_debug:
            return {
                "similarity": similarity,
                "code1_vector": debug1,
                "code2_vector": debug2,
            }
        return similarity
    
    def find_most_similar(
        self, 
        query_code: str, 
        code_list: List[str], 
        lang: str = 'c'
    ) -> List[Tuple[int, float]]:
        """
        在代码列表中找到与查询代码最相似的代码
        
        Args:
            query_code: 查询代码片段
            code_list: 待比较的代码片段列表
            lang: 编程语言
            
        Returns:
            列表，每个元素为 (索引, 相似度)，按相似度降序排列
        """
        query_vector = self.encode_code(query_code, lang)
        code_vectors = self.batch_encode(code_list, lang)
        
        # 计算查询代码与所有代码的相似度
        similarities = cosine_similarity([query_vector], code_vectors)[0]
        
        # 按相似度降序排列
        results = [(i, float(sim)) for i, sim in enumerate(similarities)]
        results.sort(key=lambda x: x[1], reverse=True)
        
        return results
    
    def analyze_code(self, code: str, lang: str = 'c') -> Dict[str, Any]:
        """
        分析代码，返回预处理结果和DFG信息
        
        Args:
            code: 源代码
            lang: 编程语言
            
        Returns:
            包含分析结果的字典
        """
        cleaned_code, code_tokens, dfg = self.preprocess_code(code, lang)
        
        return {
            'original_code': code,
            'cleaned_code': cleaned_code,
            'token_count': len(code_tokens),
            'dfg_edges': len(dfg),
            'dfg': dfg,
            'dfg_string': self._dfg_to_string(dfg)
        }
    
    # ========================================================================
    # Token 级语义对齐功能
    # ========================================================================
    
    def get_token_embeddings(self, code: str, lang: str = 'c') -> Tuple[List[str], np.ndarray, List[int]]:
        """
        获取代码每个 token 的向量表示
        
        Args:
            code: 代码字符串
            lang: 编程语言
            
        Returns:
            (tokens, embeddings, line_numbers)
            - tokens: token 字符串列表
            - embeddings: 每个 token 的向量，形状 (n_tokens, hidden_size)
            - line_numbers: 每个 token 对应的行号
        """
        # 预处理
        cleaned_code, _, _ = self.preprocess_code(code, lang)
        
        # tokenize (不使用 return_offsets_mapping，因为慢速 tokenizer 不支持)
        inputs = self.tokenizer(
            cleaned_code,
            return_tensors='pt',
            max_length=512,
            truncation=True,
            padding=False
        )
        
        # 获取 token 字符串
        token_ids = inputs['input_ids'][0].tolist()
        tokens = self.tokenizer.convert_ids_to_tokens(token_ids)
        
        # 通过遍历代码来推断每个 token 的行号
        # 使用简单的启发式方法：按顺序匹配 token 在代码中的位置
        line_numbers = self._compute_token_line_numbers(cleaned_code, tokens)
        
        # 获取 token embeddings
        with torch.no_grad():
            outputs = self.model(**inputs)
            embeddings = outputs.last_hidden_state[0].numpy()  # (seq_len, hidden_size)
        
        return tokens, embeddings, line_numbers
    
    def _compute_token_line_numbers(self, code: str, tokens: List[str]) -> List[int]:
        """
        计算每个 token 对应的行号
        
        使用简单的启发式方法：按顺序在代码中查找 token
        """
        line_numbers = []
        current_pos = 0
        lines = code.split('\n')
        
        # 构建每行的起始位置
        line_starts = [0]
        for line in lines[:-1]:
            line_starts.append(line_starts[-1] + len(line) + 1)  # +1 for '\n'
        
        def get_line_number(pos: int) -> int:
            """根据位置获取行号"""
            for i, start in enumerate(line_starts):
                if i + 1 < len(line_starts):
                    if start <= pos < line_starts[i + 1]:
                        return i + 1
                else:
                    if start <= pos:
                        return i + 1
            return len(lines)
        
        for token in tokens:
            # 特殊 token 处理
            if token in ['<s>', '</s>', '<pad>', '<unk>', '<mask>']:
                line_numbers.append(0)
                continue
            
            # 清理 token（去掉 BPE 标记如 'Ġ'）
            clean_token = token.replace('Ġ', ' ').replace('Ċ', '\n').lstrip('▁')
            
            if not clean_token:
                line_numbers.append(get_line_number(current_pos))
                continue
            
            # 在代码中查找 token
            found_pos = code.find(clean_token, current_pos)
            if found_pos == -1:
                # 尝试不带空格查找
                clean_token_no_space = clean_token.strip()
                if clean_token_no_space:
                    found_pos = code.find(clean_token_no_space, current_pos)
            
            if found_pos != -1:
                line_num = get_line_number(found_pos)
                line_numbers.append(line_num)
                current_pos = found_pos + len(clean_token)
            else:
                # 找不到，使用当前位置的行号
                line_numbers.append(get_line_number(current_pos))
        
        return line_numbers
    
    def compute_token_similarity_matrix(
        self, 
        embeddings1: np.ndarray, 
        embeddings2: np.ndarray
    ) -> np.ndarray:
        """
        计算两组 token 向量的相似度矩阵
        
        Args:
            embeddings1: 代码1的 token 向量 (n1, hidden_size)
            embeddings2: 代码2的 token 向量 (n2, hidden_size)
            
        Returns:
            相似度矩阵 (n1, n2)
        """
        return cosine_similarity(embeddings1, embeddings2)
    
    def align_tokens(
        self,
        tokens1: List[str],
        tokens2: List[str],
        similarity_matrix: np.ndarray,
        threshold: float = 0.85
    ) -> List[Dict[str, Any]]:
        """
        基于相似度矩阵对齐 tokens
        使用贪婪匹配算法
        
        Args:
            tokens1: 代码1的 tokens
            tokens2: 代码2的 tokens
            similarity_matrix: 相似度矩阵
            threshold: 匹配阈值
            
        Returns:
            对齐结果列表
        """
        n1, n2 = len(tokens1), len(tokens2)
        used1 = set()
        used2 = set()
        alignments = []
        
        # 找出所有高于阈值的匹配，按相似度降序处理
        candidates = []
        for i in range(n1):
            for j in range(n2):
                sim = similarity_matrix[i, j]
                if sim >= threshold:
                    candidates.append((sim, i, j))
        
        candidates.sort(reverse=True)
        
        # 贪婪匹配
        for sim, i, j in candidates:
            if i not in used1 and j not in used2:
                used1.add(i)
                used2.add(j)
                alignments.append({
                    'token1': tokens1[i],
                    'token2': tokens2[j],
                    'index1': i,
                    'index2': j,
                    'similarity': float(sim),
                    'is_exact_match': tokens1[i] == tokens2[j]
                })
        
        return alignments
    
    def align_lines(
        self,
        code1: str,
        code2: str,
        lang: str = 'c',
        threshold: float = 0.80
    ) -> Dict[str, Any]:
        """
        基于模型语义对齐两段代码的行
        
        Args:
            code1: 代码1
            code2: 代码2
            lang: 编程语言
            threshold: 行对齐阈值
            
        Returns:
            行对齐结果
        """
        # 获取 token 级别的信息
        tokens1, embeddings1, line_nums1 = self.get_token_embeddings(code1, lang)
        tokens2, embeddings2, line_nums2 = self.get_token_embeddings(code2, lang)
        
        # 计算 token 相似度矩阵
        token_sim_matrix = self.compute_token_similarity_matrix(embeddings1, embeddings2)
        
        # 获取每行的 token 索引
        lines1 = code1.split('\n')
        lines2 = code2.split('\n')
        
        # 计算每行的聚合向量（该行所有 token 的平均向量）
        def get_line_embedding(embeddings, line_nums, target_line):
            indices = [i for i, ln in enumerate(line_nums) if ln == target_line]
            if not indices:
                return None
            return embeddings[indices].mean(axis=0)
        
        line_embeddings1 = []
        valid_lines1 = []
        for i in range(1, len(lines1) + 1):
            emb = get_line_embedding(embeddings1, line_nums1, i)
            if emb is not None and lines1[i-1].strip():
                line_embeddings1.append(emb)
                valid_lines1.append(i)
        
        line_embeddings2 = []
        valid_lines2 = []
        for i in range(1, len(lines2) + 1):
            emb = get_line_embedding(embeddings2, line_nums2, i)
            if emb is not None and lines2[i-1].strip():
                line_embeddings2.append(emb)
                valid_lines2.append(i)
        
        # 计算行级相似度矩阵
        if line_embeddings1 and line_embeddings2:
            line_embeddings1 = np.array(line_embeddings1)
            line_embeddings2 = np.array(line_embeddings2)
            line_sim_matrix = cosine_similarity(line_embeddings1, line_embeddings2)
        else:
            line_sim_matrix = np.array([])
        
        # 行级对齐
        line_alignments = []
        used1 = set()
        used2 = set()
        
        if line_sim_matrix.size > 0:
            # 找出所有候选匹配
            candidates = []
            for i, line_idx1 in enumerate(valid_lines1):
                for j, line_idx2 in enumerate(valid_lines2):
                    sim = line_sim_matrix[i, j]
                    candidates.append((sim, i, j, line_idx1, line_idx2))
            
            candidates.sort(reverse=True)
            
            # 贪婪匹配
            for sim, i, j, line_idx1, line_idx2 in candidates:
                if i not in used1 and j not in used2:
                    line1_content = lines1[line_idx1 - 1].strip()
                    line2_content = lines2[line_idx2 - 1].strip()
                    
                    # 判断是否是语义等价
                    is_exact = line1_content == line2_content
                    is_equivalent = sim >= threshold
                    
                    # 只有当相似度足够高时才认为是对齐的
                    if sim >= 0.5:  # 最低阈值
                        used1.add(i)
                        used2.add(j)
                        
                        alignment_type = 'exact' if is_exact else ('equivalent' if is_equivalent else 'different')
                        
                        line_alignments.append({
                            'line1': line_idx1,
                            'line2': line_idx2,
                            'content1': line1_content,
                            'content2': line2_content,
                            'similarity': float(sim),
                            'type': alignment_type,
                            'is_semantic_equivalent': is_equivalent
                        })
        
        # 找出未匹配的行
        matched_lines1 = {a['line1'] for a in line_alignments}
        matched_lines2 = {a['line2'] for a in line_alignments}
        
        unmatched1 = []
        for i, line in enumerate(lines1, 1):
            if line.strip() and i not in matched_lines1:
                unmatched1.append({'line': i, 'content': line.strip()})
        
        unmatched2 = []
        for i, line in enumerate(lines2, 1):
            if line.strip() and i not in matched_lines2:
                unmatched2.append({'line': i, 'content': line.strip()})
        
        return {
            'line_alignments': line_alignments,
            'unmatched_lines1': unmatched1,  # 代码1中被删除的行
            'unmatched_lines2': unmatched2,  # 代码2中新增的行
            'total_lines1': len([l for l in lines1 if l.strip()]),
            'total_lines2': len([l for l in lines2 if l.strip()]),
            'matched_equivalent': len([a for a in line_alignments if a['is_semantic_equivalent']]),
            'matched_different': len([a for a in line_alignments if not a['is_semantic_equivalent']])
        }
    
    def _normalize_strip_whitespace(self, s: str) -> str:
        """去除所有空白字符"""
        import re
        return re.sub(r'\s', '', s)
    
    def _normalize_style_value(self, s: str) -> str:
        """
        规范化样式属性值
        width: 200, -> width: _NUM_,
        height: '100px' -> height: _STR_
        """
        import re
        result = s.strip()
        
        # 样式属性列表
        style_attrs = [
            'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
            'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
            'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
            'fontSize', 'lineHeight', 'top', 'bottom', 'left', 'right',
            'zIndex', 'opacity', 'flex', 'gap', 'borderRadius', 'borderWidth',
            'size', 'maxSize', 'minSize'
        ]
        
        for attr in style_attrs:
            # 匹配 attr: 数字 (包括后面可能有逗号、分号等)
            result = re.sub(rf'\b{attr}:\s*\d+(\.\d+)?', f'{attr}: _NUM_', result)
            # 匹配 attr: '字符串' 或 attr: "字符串"
            result = re.sub(rf'\b{attr}:\s*[\'"][^\'"]*[\'"]', f'{attr}: _STR_', result)
        
        # 通用：将所有独立的数字替换为 _NUM_（但保留变量名中的数字）
        # 匹配独立的数字（前后不是字母或下划线）
        result = re.sub(r'(?<![a-zA-Z_])\d+(\.\d+)?(?![a-zA-Z_])', '_NUM_', result)
        
        return result
    
    def _is_style_equivalent(self, line1: str, line2: str) -> bool:
        """判断两行是否只是样式值不同"""
        norm1 = self._normalize_style_value(line1)
        norm2 = self._normalize_style_value(line2)
        return norm1 == norm2
    
    def _is_format_equivalent(self, block1: List[str], block2: List[str]) -> bool:
        """
        判断两个代码块是否只是格式不同（如换行差异）
        例如：['<>', '</>'] 和 ['<></>'] 是等价的
        """
        concat1 = self._normalize_strip_whitespace(''.join(block1))
        concat2 = self._normalize_strip_whitespace(''.join(block2))
        return concat1 == concat2

    def semantic_diff(
        self,
        code1: str,
        code2: str,
        lang: str = 'c',
        equivalent_threshold: float = 0.85
    ) -> Dict[str, Any]:
        """
        基于语义的代码差异分析
        
        混合方法：
        1. 先用传统 diffLines 做行级对齐
        2. 对于相同的行，标记为 exact
        3. 对于删除/新增的行对，先检查是否是格式/样式等价，再用模型判断
        
        Args:
            code1: 原始代码
            code2: 待比较代码
            lang: 编程语言
            equivalent_threshold: 语义等价阈值
            
        Returns:
            语义 diff 结果
        """
        import difflib
        
        # 1. 计算整体相似度
        overall_similarity = self.calculate_similarity(code1, code2, lang)["similarity"]
        
        # 2. 用 difflib 做行级 diff
        lines1 = code1.split('\n')
        lines2 = code2.split('\n')
        
        matcher = difflib.SequenceMatcher(None, lines1, lines2)
        opcodes = matcher.get_opcodes()
        
        alignments = []
        removed_lines = []
        added_lines = []
        
        # 统计
        exact_matches = 0
        semantic_equivalent = 0
        different_lines = 0
        
        for tag, i1, i2, j1, j2 in opcodes:
            if tag == 'equal':
                # 相同的行
                for i, j in zip(range(i1, i2), range(j1, j2)):
                    alignments.append({
                        'line1': i + 1,
                        'line2': j + 1,
                        'content1': lines1[i],
                        'content2': lines2[j],
                        'similarity': 1.0,
                        'type': 'exact',
                        'is_semantic_equivalent': True
                    })
                    exact_matches += 1
                    
            elif tag == 'replace':
                # 替换的行
                removed_block = lines1[i1:i2]
                added_block = lines2[j1:j2]
                
                # 检查1: 是否只是格式不同（如换行差异）
                if self._is_format_equivalent(removed_block, added_block):
                    # 格式等价，全部标记为 equivalent
                    for idx, old_line in enumerate(removed_block):
                        old_i = i1 + idx + 1
                        # 找对应的新行（按比例映射）
                        new_idx = min(idx, len(added_block) - 1) if added_block else 0
                        new_j = j1 + new_idx + 1 if added_block else j1 + 1
                        new_line = added_block[new_idx] if added_block and new_idx < len(added_block) else ''
                        
                        alignments.append({
                            'line1': old_i,
                            'line2': new_j,
                            'content1': old_line,
                            'content2': new_line,
                            'similarity': 1.0,
                            'type': 'equivalent',
                            'is_semantic_equivalent': True
                        })
                        semantic_equivalent += 1
                    # 处理 added_block 中多出的行
                    for idx in range(len(removed_block), len(added_block)):
                        new_j = j1 + idx + 1
                        alignments.append({
                            'line1': i2,  # 指向最后一行
                            'line2': new_j,
                            'content1': '',
                            'content2': added_block[idx],
                            'similarity': 1.0,
                            'type': 'equivalent',
                            'is_semantic_equivalent': True
                        })
                        semantic_equivalent += 1
                    continue
                
                # 尝试一对一匹配（如果行数相同）
                if len(removed_block) == len(added_block):
                    for idx, (old_line, new_line) in enumerate(zip(removed_block, added_block)):
                        old_i = i1 + idx + 1
                        new_j = j1 + idx + 1
                        
                        # 检查是否只是样式值不同
                        if self._is_style_equivalent(old_line, new_line):
                            alignments.append({
                                'line1': old_i,
                                'line2': new_j,
                                'content1': old_line,
                                'content2': new_line,
                                'similarity': 1.0,
                                'type': 'equivalent',
                                'is_semantic_equivalent': True
                            })
                            semantic_equivalent += 1
                            continue
                        
                        # 计算这两行的语义相似度
                        if old_line.strip() and new_line.strip():
                            try:
                                sim = self.calculate_similarity(old_line, new_line, lang)["similarity"]
                            except:
                                sim = 0.0
                            
                            if old_line.strip() == new_line.strip():
                                align_type = 'exact'
                                exact_matches += 1
                            elif sim >= equivalent_threshold:
                                align_type = 'equivalent'
                                semantic_equivalent += 1
                            else:
                                align_type = 'different'
                                different_lines += 1
                            
                            alignments.append({
                                'line1': old_i,
                                'line2': new_j,
                                'content1': old_line,
                                'content2': new_line,
                                'similarity': float(sim),
                                'type': align_type,
                                'is_semantic_equivalent': sim >= equivalent_threshold
                            })
                        else:
                            # 空行处理
                            alignments.append({
                                'line1': old_i,
                                'line2': new_j,
                                'content1': old_line,
                                'content2': new_line,
                                'similarity': 1.0 if old_line.strip() == new_line.strip() else 0.0,
                                'type': 'exact' if old_line.strip() == new_line.strip() else 'different',
                                'is_semantic_equivalent': old_line.strip() == new_line.strip()
                            })
                            if old_line.strip() == new_line.strip():
                                exact_matches += 1
                            else:
                                different_lines += 1
                else:
                    # 行数不同，标记为删除和新增
                    for idx, old_line in enumerate(removed_block):
                        if old_line.strip():
                            removed_lines.append({
                                'line': i1 + idx + 1,
                                'content': old_line.strip()
                            })
                    for idx, new_line in enumerate(added_block):
                        if new_line.strip():
                            added_lines.append({
                                'line': j1 + idx + 1,
                                'content': new_line.strip()
                            })
                            
            elif tag == 'delete':
                # 删除的行
                for idx in range(i1, i2):
                    if lines1[idx].strip():
                        removed_lines.append({
                            'line': idx + 1,
                            'content': lines1[idx].strip()
                        })
                        
            elif tag == 'insert':
                # 新增的行
                for idx in range(j1, j2):
                    if lines2[idx].strip():
                        added_lines.append({
                            'line': idx + 1,
                            'content': lines2[idx].strip()
                        })
        
        # 后处理：对 removed 和 added 行进行匹配检查
        final_removed = []
        final_added = []
        matched_removed = set()  # 已匹配的 removed 行号
        matched_added = set()    # 已匹配的 added 行号
        
        if removed_lines and added_lines:
            # 1. 先进行一对一的样式值等价匹配
            for r in removed_lines:
                if r['line'] in matched_removed:
                    continue
                for a in added_lines:
                    if a['line'] in matched_added:
                        continue
                    # 检查样式值等价
                    if self._is_style_equivalent(r['content'], a['content']):
                        alignments.append({
                            'line1': r['line'],
                            'line2': a['line'],
                            'content1': r['content'],
                            'content2': a['content'],
                            'similarity': 1.0,
                            'type': 'equivalent',
                            'is_semantic_equivalent': True
                        })
                        semantic_equivalent += 1
                        matched_removed.add(r['line'])
                        matched_added.add(a['line'])
                        break
            
            # 2. 按连续性分组，进行格式等价匹配
            def group_consecutive(items: List[Dict]) -> List[List[Dict]]:
                if not items:
                    return []
                # 过滤掉已匹配的
                filtered = [item for item in items if item['line'] not in matched_removed and item['line'] not in matched_added]
                if not filtered:
                    return []
                groups = []
                current_group = [filtered[0]]
                for i in range(1, len(filtered)):
                    if filtered[i]['line'] == filtered[i-1]['line'] + 1:
                        current_group.append(filtered[i])
                    else:
                        groups.append(current_group)
                        current_group = [filtered[i]]
                groups.append(current_group)
                return groups
            
            removed_groups = group_consecutive(removed_lines)
            added_groups = group_consecutive(added_lines)
            
            matched_rg_indices = set()
            matched_ag_indices = set()
            
            # 尝试匹配每个删除组和新增组（格式等价）
            for rg_idx, rg in enumerate(removed_groups):
                removed_concat = self._normalize_strip_whitespace(''.join(r['content'] for r in rg))
                
                for ag_idx, ag in enumerate(added_groups):
                    if ag_idx in matched_ag_indices:
                        continue
                    added_concat = self._normalize_strip_whitespace(''.join(a['content'] for a in ag))
                    
                    if removed_concat == added_concat and removed_concat:
                        # 匹配成功
                        for idx, r in enumerate(rg):
                            a = ag[min(idx, len(ag) - 1)] if ag else {'line': 0, 'content': ''}
                            alignments.append({
                                'line1': r['line'],
                                'line2': a['line'],
                                'content1': r['content'],
                                'content2': a['content'],
                                'similarity': 1.0,
                                'type': 'equivalent',
                                'is_semantic_equivalent': True
                            })
                            semantic_equivalent += 1
                            matched_removed.add(r['line'])
                        for a in ag:
                            matched_added.add(a['line'])
                        
                        matched_rg_indices.add(rg_idx)
                        matched_ag_indices.add(ag_idx)
                        break
            
            # 收集未匹配的
            final_removed = [r for r in removed_lines if r['line'] not in matched_removed]
            final_added = [a for a in added_lines if a['line'] not in matched_added]
        else:
            final_removed = removed_lines
            final_added = added_lines
        
        # 统计
        stats = {
            'overall_similarity': overall_similarity,
            'total_lines1': len([l for l in lines1 if l.strip()]),
            'total_lines2': len([l for l in lines2 if l.strip()]),
            'exact_matches': exact_matches,
            'semantic_equivalent': semantic_equivalent,
            'different_lines': different_lines,
            'removed_lines': len(final_removed),
            'added_lines': len(final_added)
        }
        
        return {
            'similarity': overall_similarity,
            'stats': stats,
            'alignments': alignments,
            'removed': final_removed,
            'added': final_added
        }
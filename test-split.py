#!/usr/bin/env python3
"""测试对称拆分功能"""

import requests
import json

# 读取测试文件
with open('diff-code/index1.tsx', 'r') as f:
    code1 = f.read()

with open('diff-code/index2.tsx', 'r') as f:
    code2 = f.read()

# 调用拆分接口
response = requests.post(
    'http://localhost:8000/split-with-treesitter',
    json={
        'code1': code1,
        'code2': code2,
        'lang': 'tsx'
    }
)

if response.status_code == 200:
    data = response.json()
    
    print("=" * 60)
    print(f"代码 A 拆分结果（共 {len(data['units1'])} 个单元）：")
    print("=" * 60)
    for u in data['units1']:
        print(f"  - {u['name']} ({u['type']}) [{u['startLine']}-{u['endLine']}] {u['lineCount']} 行")
    
    print("\n" + "=" * 60)
    print(f"代码 B 拆分结果（共 {len(data['units2'])} 个单元）：")
    print("=" * 60)
    for u in data['units2']:
        print(f"  - {u['name']} ({u['type']}) [{u['startLine']}-{u['endLine']}] {u['lineCount']} 行")
    
    # 检查对称性
    print("\n" + "=" * 60)
    print("对称性检查：")
    print("=" * 60)
    
    names1 = set(u['name'] for u in data['units1'])
    names2 = set(u['name'] for u in data['units2'])
    
    # 提取基础名称（去掉父级路径）
    bases1 = set(n.split('/')[0] for n in names1)
    bases2 = set(n.split('/')[0] for n in names2)
    
    print(f"代码 A 的父单元: {bases1}")
    print(f"代码 B 的父单元: {bases2}")
    
    # 检查子单元
    subs1 = [n for n in names1 if '/' in n]
    subs2 = [n for n in names2 if '/' in n]
    
    print(f"\n代码 A 有 {len(subs1)} 个子单元")
    print(f"代码 B 有 {len(subs2)} 个子单元")
    
    if len(subs1) > 0 and len(subs2) == 0:
        print("\n⚠️  检测到不对称拆分！代码 A 被拆分了，代码 B 没有！")
    elif len(subs2) > 0 and len(subs1) == 0:
        print("\n⚠️  检测到不对称拆分！代码 B 被拆分了，代码 A 没有！")
    else:
        print("\n✅ 拆分策略对称")
else:
    print(f"错误: {response.status_code}")
    print(response.text)

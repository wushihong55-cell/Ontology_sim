"""
统计出差次数最多的员工及其部门

## 诊断结论

当前图数据存在一个「缺失的外键」问题：
- Schema 中定义了 Employee --[applies]--> BusinessTrip 关系（员工发起出差申请）
- 但实际导入的 07_business_trip.json 数据中，每条 BusinessTrip 记录
  仅含行程本身的字段（目的地、日期、金额等），没有 employeeId 外键
- Neo4j 中也没有 EntityInstance→EntityInstance 边

因此，当前图数据实例无法直接回答"哪个员工出差次数最多"。

## 本脚本的解决思路

Step 1: 从 Neo4j 读取当前实例（验证数据）
Step 2: 直接从源文件读取数据（更完整）
Step 3: 用「合理随机分配」补全缺失的 employeeId 链接
         分配规则：职级越高（P7/P8）出差概率越大，符合业务现实
Step 4: 输出答案 + 明确标注这是模拟结果
Step 5: 给出将真实 employeeId 导入图谱的 Cypher 方案
"""

import json
import random
from pathlib import Path
from collections import Counter, defaultdict

DATA_DIR = Path(__file__).parent.parent / "template" / "sample-data"

# ── 1. 载入源数据 ────────────────────────────────────────────────────────────

def load(filename):
    with open(DATA_DIR / filename) as f:
        d = json.load(f)
    return d["data"] if isinstance(d, dict) and "data" in d else d

employees   = load("05_employee.json")   # 40 人
trips       = load("07_business_trip.json")  # 220 条
departments = load("03_department.json") # 4 个
job_grades  = load("04_job_grade.json")  # 职级

print("=" * 60)
print("Step 1 | 当前图数据规模（直接从源文件）")
print("=" * 60)
print(f"  员工数:    {len(employees)}")
print(f"  出差记录:  {len(trips)}")
print(f"  部门数:    {len(departments)}")
print()

# ── 2. 展示能直接回答的统计 ─────────────────────────────────────────────────

dept_map = {d["id"]: d["nameZh"] for d in departments}
emp_map  = {e["id"]: e for e in employees}

print("=" * 60)
print("Step 2 | 当前数据可以直接回答的问题")
print("=" * 60)

# 2a. 各部门人数
dept_counts = Counter(e["departmentId"] for e in employees)
print("  [各部门员工数]")
for dept_id, cnt in sorted(dept_counts.items()):
    print(f"    {dept_map.get(dept_id, dept_id)}: {cnt} 人")
print()

# 2b. 出差目的地排名
dest_counts = Counter(t["destinationCity"] for t in trips)
print("  [出差目的地 TOP5]")
for city, cnt in dest_counts.most_common(5):
    print(f"    {city}: {cnt} 次")
print()

# ── 3. 诊断缺失链接 ──────────────────────────────────────────────────────────

print("=" * 60)
print("Step 3 | 数据缺口诊断")
print("=" * 60)
trip_fields = set(k for t in trips for k in t.keys())
print(f"  BusinessTrip 的所有字段: {sorted(trip_fields)}")
print()
print("  ❌ 关键缺失字段: employeeId")
print("  原因: 07_business_trip.json 未包含员工外键")
print("  结果: 无法在当前图中执行 Employee→BusinessTrip 关联查询")
print()

# ── 4. 补全缺失外键（模拟分配，基于职级权重）─────────────────────────────────

print("=" * 60)
print("Step 4 | 模拟补全 employeeId（职级权重分配）")
print("=" * 60)

# 职级权重：P8/P7 资深员工出差频率更高
# 从职级 ID 中提取数字作为权重（JG-P8 → 8，代表资深员工出差频率更高）
def grade_weight(grade_id: str) -> int:
    try:
        return int(grade_id.replace("JG-P", ""))
    except ValueError:
        return 3

def trip_weight(emp):
    return max(1, grade_weight(emp.get("jobGradeId", "JG-P3")))

rng = random.Random(42)  # 固定种子，结果可复现

weights  = [trip_weight(e) for e in employees]
emp_ids  = [e["id"] for e in employees]

# 按权重随机分配每条出差记录到一名员工
assigned = rng.choices(emp_ids, weights=weights, k=len(trips))
trip_to_emp = {t["id"]: emp_id for t, emp_id in zip(trips, assigned)}

print(f"  已将 {len(trips)} 条出差记录按职级权重分配给 {len(employees)} 名员工")
print()

# ── 5. 统计出差次数 ──────────────────────────────────────────────────────────

trip_count_by_emp = Counter(assigned)
top_emp_id, top_count = trip_count_by_emp.most_common(1)[0]
top_emp = emp_map[top_emp_id]
top_dept = dept_map.get(top_emp["departmentId"], top_emp["departmentId"])

print("=" * 60)
print("Step 5 | 统计结果（基于模拟分配）")
print("=" * 60)
print()
print(f"  ✅ 出差次数最多的员工:")
print(f"     姓名:   {top_emp['name']}")
print(f"     工号:   {top_emp['empNo']}")
print(f"     职级:   {top_emp['jobGradeId']}")
print(f"     部门:   {top_dept}")
print(f"     出差次数: {top_count} 次")
print()
print("  [出差次数 TOP10 员工]")
print(f"  {'排名':<4} {'员工ID':<8} {'姓名':<10} {'职级':<8} {'部门':<12} {'次数':>5}")
print("  " + "-" * 52)
for rank, (eid, cnt) in enumerate(trip_count_by_emp.most_common(10), 1):
    e = emp_map[eid]
    dept = dept_map.get(e["departmentId"], e["departmentId"])
    print(f"  {rank:<4} {eid:<8} {e['name']:<10} {e['jobGradeId']:<8} {dept:<12} {cnt:>5}")
print()

# ── 6. 真实解决方案 ──────────────────────────────────────────────────────────

print("=" * 60)
print("Step 6 | 真实解决方案 — 如何在图谱中建立 Employee→Trip 链接")
print("=" * 60)
print("""
  方案A（推荐）: 在源数据中补充 employeeId 字段，重新导入
  ---------------------------------------------------------
  1. 在 07_business_trip.json 每条记录中加入 "employeeId": "E001"
  2. 在应用中重新导入数据集
  3. 使用以下 Cypher 建立图边:

     MATCH (emp:EntityInstance { _entityDefId: 'tn-employee' })-[:IN_TWIN]->(t:BizTwin { id: $twinId })
     MATCH (trip:EntityInstance { _entityDefId: 'tn-businesstrip' })-[:IN_TWIN]->(t)
     WHERE trip.employeeId = emp.id
     CREATE (emp)-[:APPLIES_FOR]->(trip)

  4. 查询出差次数最多的员工:

     MATCH (emp:EntityInstance { _entityDefId: 'tn-employee' })-[:IN_TWIN]->(t:BizTwin { id: $twinId })
     MATCH (emp)-[:APPLIES_FOR]->(trip:EntityInstance { _entityDefId: 'tn-businesstrip' })
     MATCH (dept:EntityInstance { _entityDefId: 'tn-department', id: emp.departmentId })
     RETURN emp.name AS 姓名, dept.nameZh AS 部门, count(trip) AS 出差次数
     ORDER BY 出差次数 DESC
     LIMIT 1

  方案B: 通过 employeeId 属性直接查询（无需建边）
  --------------------------------------------------
  如果 BusinessTrip 记录有 employeeId 字段，可以直接：

     MATCH (emp:EntityInstance { _entityDefId: 'tn-employee' })-[:IN_TWIN]->(t:BizTwin { id: 'twin-ogg2t8a' })
     MATCH (trip:EntityInstance { _entityDefId: 'tn-businesstrip' })-[:IN_TWIN]->(t)
     WHERE trip.employeeId = emp.id
     MATCH (dept:EntityInstance { _entityDefId: 'tn-department' })-[:IN_TWIN]->(t)
     WHERE dept.id = emp.departmentId
     RETURN emp.name AS 姓名, dept.nameZh AS 部门, count(trip) AS 出差次数
     ORDER BY 出差次数 DESC
     LIMIT 1
""")

# ── 7. 生成带 employeeId 的增强数据文件 ─────────────────────────────────────

output_path = Path(__file__).parent / "07_business_trip_enriched.json"
enriched = []
for t in trips:
    row = dict(t)
    row["employeeId"] = trip_to_emp[t["id"]]
    enriched.append(row)

with open(output_path, "w", encoding="utf-8") as f:
    json.dump({"data": enriched}, f, ensure_ascii=False, indent=2)

print(f"  已生成增强数据文件（含 employeeId）:")
print(f"  → {output_path}")
print(f"    共 {len(enriched)} 条记录，字段: {list(enriched[0].keys())}")
print()
print("  ⚠️  注意：以上员工分配为模拟数据（职级加权随机）。")
print("      真实分配应来自 HR/OA 系统的实际出差申请记录。")

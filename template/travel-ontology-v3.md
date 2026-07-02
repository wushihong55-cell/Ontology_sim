# 差旅活动本体模型（Travel Activity Ontology）v3

> 设计目标：为差旅报销场景建立一套可被 Claude Code / 工程团队直接落地为数据库 Schema 或图模型的本体定义。本文档面向实现者，包含实体定义、字段、关系、设计取舍说明和已识别的未来扩展点。

## 0. 设计哲学

本体不是数据库表设计，核心问题是"哪些概念值得拥有独立身份（Identity）"。

> **建模准则**：一个概念值得被建为独立实体，只有当它满足以下任意一条：
> 1. 会被某条业务规则单独引用（如审批策略按职级、按任务类型分支）
> 2. 会被某次查询单独检索（如"列出所有经过上海的出差"）
> 3. 会作为关系图中的节点被其他实体指向（多对多、被复用）
>
> 否则应作为属性字段（Attribute）或值对象（Value Object），不独立建表/建节点。

业务因果链方向（不可逆）：

```
组织(Organization) 设立 → 人员(Person) 执行 → 任务(Mission)
任务被履行为 → 出差活动(Trip)
活动经过 → 城市(City)
活动消耗资源、留下 → 证据(Evidence)
关键状态转移记录为 → 事件(Event)
```

票证/证据是活动的"果"，不是建模起点。**不要以发票为中心反推业务结构**。

---

## 1. 核心实体一览（6 类主实体 + 1 类事件）

| 实体 | 角色 | 是否产品界面暴露 |
|---|---|---|
| Organization | 组织主体 | 是 |
| Person | 人员 | 是 |
| Mission | 任务 | 是 |
| Trip | 出差活动 | 是 |
| City | 城市 | 是 |
| Evidence | 证据（含票证） | 是 |
| Event | 关键业务事件 | 是（轻量） |

此外有 **2 个已识别但暂不建表的扩展点**（TripSegment、Carrier），见第 5 章。

---

## 2. 实体定义

### 2.1 Organization（组织）

仅两层，不做 Team / Project / Cost Center。

```
Company
  - id
  - name

Department
  - id
  - name
  - company_id        (FK → Company)
  - parent_dept_id     (FK → Department, 可空，支持层级)
```

**取舍说明**：Team 在多数公司只是 Department 的非正式细分，差旅场景没有独立审批/预算意义。Project、Cost Center 属于财务维度概念，与"抛开财务体系"的设计前提冲突，若未来需要按项目归集费用，做成 `Mission.project_code` 字段即可，不建实体。

---

### 2.2 Person（人员）

不分 Employee / Manager / Approver 子类型，用角色字段表达（同一人可能在不同出差中既是申请人又是审批人）。

```
Person
  - id
  - name
  - employee_no
  - grade              (职级，决定报销标准的关键字段)
  - department_id       (FK → Department)
  - home_city_id        (FK → City，常驻城市)
  - manager_id          (FK → Person，自反关系，表达汇报链)
```

---

### 2.3 Mission（任务）

> 这是差旅的"动因"层，区别于传统报销系统直接以"出差申请"为起点的设计。

```
Mission
  - id
  - name
  - mission_type        (枚举：拜访客户/培训/会议/投标/项目实施... 影响报销策略)
  - start_time
  - end_time
  - project_code         (可空，财务归集用，替代独立 Project 实体)
  - priority             (可空)
```

关系：
```
Mission --ASSIGNED_TO--> Person        (一个任务可分配给一人或多人)
Mission <--FULFILLS-- Trip              (见 2.4，多对多)
```

---

### 2.4 Trip（出差活动）— 模型枢纽

```
Trip
  - id
  - person_id            (FK → Person)
  - departure_time
  - return_time
  - status                (规划中/进行中/已结束/已报销)
  - origin_city_id         (FK → City)
  - destination_city_id    (FK → City，主要目的地；途经城市见 VISITS 关系)
```

关系：
```
Person   --TAKES-->        Trip
Trip     --FULFILLS-->     Mission      (多对多，中间表可加 is_primary 标记)
Trip     --VISITS-->       City         (多对多，覆盖多城市出差)
Evidence --BELONG_TO-->    Trip
```

**关键设计**：`Mission ←→ Trip` 是多对多，不是一对一。一次出差可服务多个任务（上午拜访客户A，下午拜访客户B），一个任务也可能跨多次出差完成（同一项目分三次出差到不同城市）。中间关联表建议结构：

```
MissionTripLink
  - mission_id
  - trip_id
  - is_primary           (可空，标记该 Trip 对该 Mission 是否为主要履行行为)
```

**未建 TripSegment 的说明**：城市间的位移关系由 Evidence（票证）自身的出发地/到达地字段表达即可，无需额外的"行程段"实体承载。已识别为未来扩展点，见第 5 章。

---

### 2.5 City（城市）

不做 Country/Province/POI 四级，仅保留城市颗粒度，因为这是报销规则真正判断的最小单位（住宿限额、出差补贴标准按城市定，不按具体车站/机场定）。

```
City
  - id
  - name
  - city_tier             (城市级别：一线/新一线/二线... 决定报销限额)
```

具体车站、机场、酒店名称等 POI 信息，**降级为 Evidence 子类的字段**，不独立建实体（理由见第 5 章）。

---

### 2.6 Evidence（证据，原 Document）— 关键改名

> 由 "Document" 改名为 "Evidence"，因为现实中能证明"这次出差真实发生"的不止票证：GPS 定位、日历安排、企业微信签到、酒店门锁记录等都是同等地位的证据。命名为 Document 会预设"纸面/电子文件"的范畴，限制未来扩展。

基类 + 子类继承结构：

```
Evidence (基类)
  - id
  - trip_id              (FK → Trip)
  - evidence_type         (区分子类：ticket/invoice/gps/calendar/badge...)
  - amount                (可空，非金额类证据如GPS无此字段)
  - currency               (可空)
  - issue_date              (可空)
  - doc_no                  (可空，发票号/凭证号)
  - origin_place             (可空，文本字段，如"北京南站"，不建实体)
  - destination_place         (可空，同上)

TransportTicket (Evidence 子类)
  - transport_mode          (枚举：高铁/飞机/出租车/地铁/大巴...)
  - seat_class               (可空，如二等座/商务舱)
  - service_no                (可空，车次/航班号，纯文本，不建 Carrier 实体)

HotelInvoice (Evidence 子类)
  - check_in_date
  - check_out_date
  - nights
  - hotel_name              (文本字段，不建 POI 实体)

LocalTransportTicket (Evidence 子类)
  - transport_mode           (出租车/地铁)
  - amount
  (起讫点常缺失，允许为空)
```

**当前阶段产品落地建议只实现 TransportTicket / HotelInvoice / LocalTransportTicket 三个子类**，未来接入 GPS、日历、签到等新证据源时，按相同模式新增子类即可，**不需要改动 Trip / Mission / Person 等核心骨架**——这是采纳"证据驱动而非票证驱动"思路后获得的扩展性收益。

---

### 2.7 Event（关键业务事件，轻量）

> 不记录完整生命周期（订票→值机→登机→入住→退房），只记录会触发审批/稽核规则的节点，避免事件表无限膨胀且无人维护。

```
Event
  - id
  - event_type           (枚举，见下)
  - occurred_at
  - operator_id           (FK → Person)
  - related_trip_id        (可空，FK → Trip)
  - related_evidence_id     (可空，FK → Evidence)
```

初始枚举值（用通用业务命名，不用强耦合的中文术语，便于未来扩展不改 Schema）：

```
TICKET_PURCHASED
TICKET_REFUNDED
EXPENSE_SUBMITTED
EXPENSE_APPROVED
EXPENSE_REJECTED
EXPENSE_PAID
```

未来如需 `HOTEL_CHECKED_IN` 等，直接扩展枚举值，不改表结构。

---

## 3. 完整关系图

```
Company ──HAS──> Department ──HAS──> Person
                                        │
                          ┌─────────────┼──────────────┐
                          │             │              │
                     TAKES│        ASSIGNED_TO    REPORT_TO(自反)
                          ▼             ▼
                        Trip ◄──FULFILLS── Mission
                          │
                ┌─────────┼─────────┐
           VISITS│              BELONG_TO(反向)
                  ▼                  ▼
                City              Evidence(基类)
                                     ├─ TransportTicket
                                     ├─ HotelInvoice
                                     └─ LocalTransportTicket

Event ──关联──> Trip / Evidence，operator_id ──关联──> Person
```

---

## 4. 核心关系定义表

| 关系 | 方向 | 基数 | 说明 |
|---|---|---|---|
| BELONG_TO | Department → Company | N:1 | |
| BELONG_TO | Person → Department | N:1 | |
| REPORT_TO | Person → Person | N:1 | 自反，汇报链 |
| ASSIGNED_TO | Mission → Person | N:N | 一个任务可多人参与 |
| TAKES | Person → Trip | 1:N | 一人可有多次出差 |
| FULFILLS | Trip → Mission | N:N | **关键修正点**，见2.4 |
| VISITS | Trip → City | N:N | 覆盖多城市出差 |
| BELONG_TO | Evidence → Trip | N:1 | 一次出差产生多张凭证 |

---

## 5. 已识别但暂不建表的扩展点（重要，写给后续开发者）

> 这两项不是"忘记做"，是经过评估后**主动决定延迟建表**，理由是：没有真实数据流程支撑的实体表，本质是无人维护的空表，反而增加系统认知负担。以下记录触发条件，供未来评估是否需要升级。

### 5.1 Carrier / Transport 实体（交通工具客观实体）

**现状**：`TransportTicket.service_no` 只是文本字段（如 "G123"），不关联到独立实体。

**触发升级条件**：当出现真实业务需求"查询同一班次的其他同行员工"或类似的跨 Trip 关联分析时，再建立：

```
Carrier
  - id
  - service_no
  - carrier_type        (高铁/航班/地铁线路)
```

并将 `TransportTicket.service_no` 改为 FK 指向 `Carrier.id`。**升级前必须先设计好 Carrier 实例的去重/匹配逻辑**（同一车次每天的实例是否复用，否则会产生大量重复脏数据）。

### 5.2 TripSegment（行程段）

**现状**：多城市出差的位移关系由 `Trip.VISITS City`（多对多）+ 各 Evidence 自带的 origin/destination 字段表达，不单独建段。

**触发升级条件**：当接入无票证的位移数据源（自驾、滴滴/高德等第三方位置服务的 API 数据）时，这些位移没有对应的 Evidence 记录，需要：

```
TripSegment
  - id
  - trip_id
  - sequence_no
  - origin_city_id
  - destination_city_id
  - depart_time
  - arrive_time
  - source              (manual/third_party_api)
```

**注意**：90% 的 Trip 只有单一位移，升级后产品界面无需暴露此层，仅在数据导入流程内部使用。

### 5.3 Place（POI 精细化，机场/车站/酒店独立建模）

**当前结论**：不建。机场到机场距离判断、合理性校验等场景，通过 `Evidence` 字段中的地点文本 + 外部静态地理坐标查询表即可解决，不需要让 POI 获得图节点身份。

**重新评估条件**：仅当出现"哪些出差经过了同一机场/同一酒店"这类真正需要在关系图中做多跳查询的需求时，才考虑将 City 升级为 Place 并引入 POI 子类型。**当前不预留任何隐藏字段或表**，避免无依据的过度设计。

---

## 6. 实施建议（给 Claude Code / 工程团队）

1. **第一阶段建表范围**：仅实现第 2 章的 6 类核心实体 + Event，共约 10 张表（含 Evidence 的 3 个子类、MissionTripLink 中间表）。
2. **Evidence 子类的存储方式**：建议用单表继承（STI，一张 evidence 表 + evidence_type 字段区分子类，子类专属字段允许为空）或类表继承均可，根据团队 ORM 偏好选择，不影响本体语义。
3. **Event 表的写入时机**：在业务流程的状态转移点（提交、审批、退票）由应用层显式写入，不依赖数据库触发器，保持业务语义清晰可追溯。
4. **不要在当前阶段实现第 5 章的扩展点**，仅在代码注释或技术文档中标注"已识别，触发条件见 ontology 文档 5.1/5.2/5.3”，避免团队成员误以为该层已经完整实现。
5. **命名一致性**：所有代码、API、数据库字段统一使用本文档的英文实体名（Evidence 而非 Document，FULFILLS 而非 RELATES_TO），避免团队内部出现术语漂移。

---

## 7. 版本演进记录

| 版本 | 核心变化 |
|---|---|
| v1 | 仅组织+票证两层，缺任务动因层 |
| v2 | 引入 Mission，City 替代四级地点，Transport/TripSegment 降级为字段 |
| v3（本版） | Document→Evidence改名，Mission-Trip关系改为多对多+FULFILLS语义，明确记录Carrier/TripSegment/Place三个延迟决策的扩展点及其触发条件 |

#!/usr/bin/env node
/**
 * 差旅费用本体样例数据生成脚本
 * 运行: node scripts/generate-sample-data.mjs
 * 输出: template/sample-data/*.json
 */
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

const OUT = 'template/sample-data'

// ─── 确定性随机 ────────────────────────────────────────────────────────────
let _seed = 0x87654321
function _rand() {
  _seed ^= _seed << 13
  _seed ^= _seed >> 17
  _seed ^= _seed << 5
  return (_seed >>> 0) / 0xFFFFFFFF
}
const ri = (min, max) => Math.floor(_rand() * (max - min + 1)) + min
const pick = arr => arr[Math.floor(_rand() * arr.length)]
const bool = (p = 0.5) => _rand() < p

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const pad2 = n => String(n).padStart(2, '0')
const pad3 = n => String(n).padStart(3, '0')

// ─── 城市 ──────────────────────────────────────────────────────────────────
const CITIES = [
  { id: 'CITY-GZ', name: '广州', province: '广东省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-WH', name: '武汉', province: '湖北省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-BJ', name: '北京', province: '北京市', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-SH', name: '上海', province: '上海市', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-SZ', name: '深圳', province: '广东省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-HZ', name: '杭州', province: '浙江省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-CD', name: '成都', province: '四川省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-CQ', name: '重庆', province: '重庆市', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-NJ', name: '南京', province: '江苏省', country: '中国', isPopularBizDestination: true },
  { id: 'CITY-XA', name: '西安', province: '陕西省', country: '中国', isPopularBizDestination: false },
  { id: 'CITY-CS', name: '长沙', province: '湖南省', country: '中国', isPopularBizDestination: false },
  { id: 'CITY-XM', name: '厦门', province: '福建省', country: '中国', isPopularBizDestination: false },
  { id: 'CITY-HF', name: '合肥', province: '安徽省', country: '中国', isPopularBizDestination: false },
  { id: 'CITY-SU', name: '苏州', province: '江苏省', country: '中国', isPopularBizDestination: false },
  { id: 'CITY-ZZ', name: '郑州', province: '河南省', country: '中国', isPopularBizDestination: false },
]

// ─── 公司 ──────────────────────────────────────────────────────────────────
const COMPANY = [
  { id: 'C001', name: '广州云枢科技有限公司', industry: '软件开发', scale: 110, city: '广州' },
]

// ─── 部门 ──────────────────────────────────────────────────────────────────
const DEPTS = [
  { id: 'D001', name: 'AdminDept',      nameZh: '行政管理部', headcount: 8,  budgetCenter: 'CC-ADMIN-001' },
  { id: 'D002', name: 'RDDept1',        nameZh: '研发一部',   headcount: 35, budgetCenter: 'CC-RD1-001'  },
  { id: 'D003', name: 'RDDept2',        nameZh: '研发二部',   headcount: 32, budgetCenter: 'CC-RD2-001'  },
  { id: 'D004', name: 'DeliveryCenter', nameZh: '交付中心',   headcount: 35, budgetCenter: 'CC-DC-001'   },
]

// ─── 职级 ──────────────────────────────────────────────────────────────────
const JOB_GRADES = [
  { id: 'JG-P1', code: 'P1', name: '初级工程师',      gradeType: '技术序列', tier: '低档', accommodationLimit: 300,  dailyMealAllowance: 80,  airClass: '经济舱' },
  { id: 'JG-P2', code: 'P2', name: '工程师',          gradeType: '技术序列', tier: '低档', accommodationLimit: 350,  dailyMealAllowance: 80,  airClass: '经济舱' },
  { id: 'JG-P3', code: 'P3', name: '高级工程师',      gradeType: '技术序列', tier: '低档', accommodationLimit: 400,  dailyMealAllowance: 100, airClass: '经济舱' },
  { id: 'JG-P4', code: 'P4', name: '资深工程师',      gradeType: '技术序列', tier: '低档', accommodationLimit: 400,  dailyMealAllowance: 100, airClass: '经济舱' },
  { id: 'JG-P5', code: 'P5', name: '技术专家',        gradeType: '技术序列', tier: '中档', accommodationLimit: 550,  dailyMealAllowance: 120, airClass: '经济舱' },
  { id: 'JG-P6', code: 'P6', name: '高级技术专家',    gradeType: '技术序列', tier: '中档', accommodationLimit: 700,  dailyMealAllowance: 150, airClass: '经济舱' },
  { id: 'JG-P7', code: 'P7', name: '部门总监',        gradeType: '技术序列', tier: '高档', accommodationLimit: 900,  dailyMealAllowance: 200, airClass: '经济舱' },
  { id: 'JG-P8', code: 'P8', name: '技术VP',          gradeType: '技术序列', tier: '高档', accommodationLimit: 1500, dailyMealAllowance: 300, airClass: '商务舱' },
]

// ─── 员工（40人代表样本）────────────────────────────────────────────────────
const EMPLOYEES = [
  // 行政管理部 6人
  { id: 'E001', name: '李国华', empNo: 'E0001', email: 'liguohua.cyz@company.com',     phone: '13800100001', hireDate: '2015-03-01', status: '在职',  jobGradeId: 'JG-P8', departmentId: 'D001' },
  { id: 'E002', name: '张慧芳', empNo: 'E0002', email: 'zhanghuifang.cyz@company.com', phone: '13800100002', hireDate: '2016-06-15', status: '在职',  jobGradeId: 'JG-P7', departmentId: 'D001' },
  { id: 'E003', name: '刘梦洁', empNo: 'E0003', email: 'liumengjie.cyz@company.com',   phone: '13800100003', hireDate: '2019-08-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D001' },
  { id: 'E004', name: '陈雅琴', empNo: 'E0004', email: 'chenyaqin.cyz@company.com',    phone: '13800100004', hireDate: '2021-03-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D001' },
  { id: 'E005', name: '黄思颖', empNo: 'E0005', email: 'huangsiying.cyz@company.com',  phone: '13800100005', hireDate: '2020-07-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D001' },
  { id: 'E006', name: '赵丽娜', empNo: 'E0006', email: 'zhaolina.cyz@company.com',     phone: '13800100006', hireDate: '2022-09-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D001' },
  // 研发一部 12人
  { id: 'E007', name: '王磊',   empNo: 'E0007', email: 'wanglei.cyz@company.com',      phone: '13800100007', hireDate: '2015-09-01', status: '在职',  jobGradeId: 'JG-P7', departmentId: 'D002' },
  { id: 'E008', name: '林俊杰', empNo: 'E0008', email: 'linjunjie.cyz@company.com',    phone: '13800100008', hireDate: '2017-04-01', status: '在职',  jobGradeId: 'JG-P6', departmentId: 'D002' },
  { id: 'E009', name: '徐志远', empNo: 'E0009', email: 'xuzhiyuan.cyz@company.com',    phone: '13800100009', hireDate: '2018-07-01', status: '在职',  jobGradeId: 'JG-P6', departmentId: 'D002' },
  { id: 'E010', name: '吴浩然', empNo: 'E0010', email: 'wuhaoran.cyz@company.com',     phone: '13800100010', hireDate: '2019-03-01', status: '在职',  jobGradeId: 'JG-P5', departmentId: 'D002' },
  { id: 'E011', name: '蒋小明', empNo: 'E0011', email: 'jiangxiaoming.cyz@company.com',phone: '13800100011', hireDate: '2020-07-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D002' },
  { id: 'E012', name: '邓宇航', empNo: 'E0012', email: 'dengyuhang.cyz@company.com',   phone: '13800100012', hireDate: '2021-03-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D002' },
  { id: 'E013', name: '郑晨',   empNo: 'E0013', email: 'zhengchen.cyz@company.com',    phone: '13800100013', hireDate: '2022-07-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D002' },
  { id: 'E014', name: '何建国', empNo: 'E0014', email: 'hejianguo.cyz@company.com',    phone: '13800100014', hireDate: '2019-09-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D002' },
  { id: 'E015', name: '马文超', empNo: 'E0015', email: 'mawenchao.cyz@company.com',    phone: '13800100015', hireDate: '2021-07-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D002' },
  { id: 'E016', name: '周天宇', empNo: 'E0016', email: 'zhoutianyu.cyz@company.com',   phone: '13800100016', hireDate: '2022-03-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D002' },
  { id: 'E017', name: '钱思远', empNo: 'E0017', email: 'qiansiyuan.cyz@company.com',   phone: '13800100017', hireDate: '2023-07-01', status: '试用期', jobGradeId: 'JG-P1', departmentId: 'D002' },
  { id: 'E018', name: '孙欣怡', empNo: 'E0018', email: 'sunxinyi.cyz@company.com',     phone: '13800100018', hireDate: '2021-09-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D002' },
  // 研发二部 11人
  { id: 'E019', name: '谢国强', empNo: 'E0019', email: 'xieguoqiang.cyz@company.com',  phone: '13800100019', hireDate: '2016-03-01', status: '在职',  jobGradeId: 'JG-P7', departmentId: 'D003' },
  { id: 'E020', name: '冯子涵', empNo: 'E0020', email: 'fengzihan.cyz@company.com',    phone: '13800100020', hireDate: '2018-04-01', status: '在职',  jobGradeId: 'JG-P6', departmentId: 'D003' },
  { id: 'E021', name: '沈晓燕', empNo: 'E0021', email: 'shenxiaoyan.cyz@company.com',  phone: '13800100021', hireDate: '2019-07-01', status: '在职',  jobGradeId: 'JG-P6', departmentId: 'D003' },
  { id: 'E022', name: '曾伟东', empNo: 'E0022', email: 'zengweidong.cyz@company.com',  phone: '13800100022', hireDate: '2019-09-01', status: '在职',  jobGradeId: 'JG-P5', departmentId: 'D003' },
  { id: 'E023', name: '许鹏程', empNo: 'E0023', email: 'xupengcheng.cyz@company.com',  phone: '13800100023', hireDate: '2020-03-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D003' },
  { id: 'E024', name: '梁敏慧', empNo: 'E0024', email: 'liangminhui.cyz@company.com',  phone: '13800100024', hireDate: '2021-07-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D003' },
  { id: 'E025', name: '唐海龙', empNo: 'E0025', email: 'tanghailong.cyz@company.com',  phone: '13800100025', hireDate: '2022-03-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D003' },
  { id: 'E026', name: '傅建平', empNo: 'E0026', email: 'fujianping.cyz@company.com',   phone: '13800100026', hireDate: '2020-07-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D003' },
  { id: 'E027', name: '程晓雯', empNo: 'E0027', email: 'chengxiaowen.cyz@company.com', phone: '13800100027', hireDate: '2021-09-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D003' },
  { id: 'E028', name: '叶伟锋', empNo: 'E0028', email: 'yeweifeng.cyz@company.com',    phone: '13800100028', hireDate: '2022-09-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D003' },
  { id: 'E029', name: '潘月华', empNo: 'E0029', email: 'panyuehua.cyz@company.com',    phone: '13800100029', hireDate: '2023-07-01', status: '试用期', jobGradeId: 'JG-P1', departmentId: 'D003' },
  // 交付中心 11人（武汉）
  { id: 'E030', name: '卢志诚', empNo: 'E0030', email: 'luzhicheng.cyz@company.com',   phone: '13800100030', hireDate: '2016-09-01', status: '在职',  jobGradeId: 'JG-P6', departmentId: 'D004' },
  { id: 'E031', name: '罗绍峰', empNo: 'E0031', email: 'luoshaofeng.cyz@company.com',  phone: '13800100031', hireDate: '2018-03-01', status: '在职',  jobGradeId: 'JG-P5', departmentId: 'D004' },
  { id: 'E032', name: '崔恒宇', empNo: 'E0032', email: 'cuihengyu.cyz@company.com',    phone: '13800100032', hireDate: '2019-07-01', status: '在职',  jobGradeId: 'JG-P5', departmentId: 'D004' },
  { id: 'E033', name: '廖盛林', empNo: 'E0033', email: 'liaoshenglin.cyz@company.com', phone: '13800100033', hireDate: '2019-09-01', status: '在职',  jobGradeId: 'JG-P5', departmentId: 'D004' },
  { id: 'E034', name: '方志远', empNo: 'E0034', email: 'fangzhiyuan.cyz@company.com',  phone: '13800100034', hireDate: '2020-03-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D004' },
  { id: 'E035', name: '庄国辉', empNo: 'E0035', email: 'zhuangguohui.cyz@company.com', phone: '13800100035', hireDate: '2020-09-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D004' },
  { id: 'E036', name: '蔡晓晨', empNo: 'E0036', email: 'caixiaochen.cyz@company.com',  phone: '13800100036', hireDate: '2021-07-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D004' },
  { id: 'E037', name: '施思源', empNo: 'E0037', email: 'shisiyuan.cyz@company.com',    phone: '13800100037', hireDate: '2021-03-01', status: '在职',  jobGradeId: 'JG-P4', departmentId: 'D004' },
  { id: 'E038', name: '尤一飞', empNo: 'E0038', email: 'youyifei.cyz@company.com',     phone: '13800100038', hireDate: '2022-03-01', status: '在职',  jobGradeId: 'JG-P3', departmentId: 'D004' },
  { id: 'E039', name: '毛浩然', empNo: 'E0039', email: 'maohaoran.cyz@company.com',    phone: '13800100039', hireDate: '2022-09-01', status: '在职',  jobGradeId: 'JG-P2', departmentId: 'D004' },
  { id: 'E040', name: '贾文轩', empNo: 'E0040', email: 'jiawenxuan.cyz@company.com',   phone: '13800100040', hireDate: '2023-07-01', status: '试用期', jobGradeId: 'JG-P1', departmentId: 'D004' },
]

// ─── 项目 ──────────────────────────────────────────────────────────────────
const PROJECTS = [
  { id: 'PROJ-2024-001', code: 'PROJ-2024-001', name: '北京某银行信贷核心系统改造',   budgetCode: 'BUD-2024-001', startDate: '2024-03-01', endDate: '2025-06-30', status: '进行中' },
  { id: 'PROJ-2024-002', code: 'PROJ-2024-002', name: '上海某保险数字化平台',         budgetCode: 'BUD-2024-002', startDate: '2024-04-01', endDate: '2025-03-31', status: '进行中' },
  { id: 'PROJ-2024-003', code: 'PROJ-2024-003', name: '深圳某互联网企业技术咨询',     budgetCode: 'BUD-2024-003', startDate: '2024-05-01', endDate: '2025-04-30', status: '进行中' },
  { id: 'PROJ-2024-004', code: 'PROJ-2024-004', name: '杭州某电商供应链系统',         budgetCode: 'BUD-2024-004', startDate: '2024-06-01', endDate: '2025-05-31', status: '进行中' },
  { id: 'PROJ-2024-005', code: 'PROJ-2024-005', name: '成都某制造企业ERP改造',        budgetCode: 'BUD-2024-005', startDate: '2024-01-15', endDate: '2025-01-14', status: '进行中' },
  { id: 'PROJ-2024-006', code: 'PROJ-2024-006', name: '重庆某政务系统建设',           budgetCode: 'BUD-2024-006', startDate: '2024-07-01', endDate: '2025-06-30', status: '进行中' },
  { id: 'PROJ-2024-007', code: 'PROJ-2024-007', name: '南京某能源集团智能管控',       budgetCode: 'BUD-2024-007', startDate: '2024-08-01', endDate: '2025-07-31', status: '进行中' },
  { id: 'PROJ-2024-008', code: 'PROJ-2024-008', name: '西安某高校数字校园',           budgetCode: 'BUD-2024-008', startDate: '2024-09-01', endDate: '2025-08-31', status: '进行中' },
  { id: 'PROJ-2024-009', code: 'PROJ-2024-009', name: '武汉交付中心内部建设',         budgetCode: 'BUD-2024-009', startDate: '2024-01-01', endDate: '2024-12-31', status: '进行中' },
  { id: 'PROJ-2024-010', code: 'PROJ-2024-010', name: '厦门某港口物流系统',           budgetCode: 'BUD-2024-010', startDate: '2024-10-01', endDate: '2025-09-30', status: '进行中' },
  { id: 'PROJ-2023-015', code: 'PROJ-2023-015', name: '长沙某医疗集团HIS系统',       budgetCode: 'BUD-2023-015', startDate: '2023-06-01', endDate: '2024-05-31', status: '已结束' },
  { id: 'PROJ-2023-016', code: 'PROJ-2023-016', name: '苏州某半导体企业MES',          budgetCode: 'BUD-2023-016', startDate: '2023-09-01', endDate: '2024-08-31', status: '已结束' },
]

// ─── 查找表 ────────────────────────────────────────────────────────────────
const JG_MAP = Object.fromEntries(JOB_GRADES.map(g => [g.id, g]))
const DEPT_CITY = { D001: '广州', D002: '广州', D003: '广州', D004: '武汉' }
const PROJ_CITY = {
  'PROJ-2024-001': '北京', 'PROJ-2024-002': '上海', 'PROJ-2024-003': '深圳',
  'PROJ-2024-004': '杭州', 'PROJ-2024-005': '成都', 'PROJ-2024-006': '重庆',
  'PROJ-2024-007': '南京', 'PROJ-2024-008': '西安', 'PROJ-2024-009': '武汉',
  'PROJ-2024-010': '厦门', 'PROJ-2023-015': '长沙', 'PROJ-2023-016': '苏州',
}

// ─── 交通方式规则 ──────────────────────────────────────────────────────────
const TRANSPORT_MODE = {
  '广州-深圳': 'train', '广州-长沙': 'train',
  '广州-厦门': 'mix',   '广州-杭州': 'mix',   '广州-南京': 'mix',
  '广州-上海': 'mix',   '广州-武汉': 'mix',   '广州-合肥': 'mix',
  '广州-苏州': 'mix',   '广州-北京': 'flight','广州-成都': 'flight',
  '广州-重庆': 'flight','广州-西安': 'flight','广州-郑州': 'flight',
  '武汉-长沙': 'train', '武汉-南京': 'train', '武汉-合肥': 'train',
  '武汉-郑州': 'train', '武汉-苏州': 'mix',   '武汉-上海': 'mix',
  '武汉-杭州': 'mix',   '武汉-北京': 'mix',   '武汉-广州': 'mix',
  '武汉-深圳': 'flight','武汉-成都': 'flight','武汉-重庆': 'flight',
  '武汉-西安': 'flight','武汉-厦门': 'flight',
}
function getTransport(from, to) {
  const m = TRANSPORT_MODE[`${from}-${to}`] || 'flight'
  if (m === 'mix') return bool(0.5) ? 'flight' : 'train'
  return m
}

// ─── 酒店池 ────────────────────────────────────────────────────────────────
const HOTELS = {
  '北京': ['北京建国饭店','北京万豪行政公寓','北京王府井希尔顿','北京商务大厦酒店','北京中关村如家'],
  '上海': ['上海外滩茂悦大酒店','上海浦东万怡酒店','上海锦江都城酒店','上海城市便捷酒店','上海龙之梦大酒店'],
  '深圳': ['深圳南山商务酒店','深圳福田希尔顿','深圳华侨城洲际','深圳宝安喜来登','深圳科技园如家'],
  '杭州': ['杭州滨江亚朵酒店','杭州西湖索菲特','杭州开元芳草地','杭州美居酒店','杭州未来科技城快捷'],
  '成都': ['成都锦江宾馆','成都香格里拉大酒店','成都万达瑞华','成都天府新区逸豫','成都人民路如家'],
  '重庆': ['重庆洲际酒店','重庆希尔顿欢朋','重庆解放碑喜来登','重庆南坪商务酒店','重庆两江如家'],
  '南京': ['南京虹悦城亚朵','南京总统大饭店','南京雅高美居','南京君悦大酒店','南京城市便捷酒店'],
  '西安': ['西安喜来登大酒店','西安唐朝国际饭店','西安曲江君豪','西安钟楼豪生','西安高新如家'],
  '长沙': ['长沙万达文华酒店','长沙运达希尔顿','长沙橘洲大酒店','长沙芒果连锁酒店','长沙城市便捷'],
  '厦门': ['厦门国际大酒店','厦门海湾大酒店','厦门美仑酒店','厦门软件园如家','厦门海峡大酒店'],
  '合肥': ['合肥滨湖会议中心酒店','合肥希岸酒店','合肥圣泰国际','合肥高新城市便捷','合肥荣冠如家'],
  '苏州': ['苏州太湖万豪','苏州工业园希尔顿','苏州金螳螂皇冠','苏州商务快捷酒店','苏州亚朵酒店'],
  '郑州': ['郑州绿地威斯汀','郑州皇冠假日','郑州航海路如家','郑州新天地汉庭','郑州快捷商务'],
  '武汉': ['武汉洲际酒店','武汉光谷亚朵','武汉喜来登','武汉光谷万怡','武汉商务快捷'],
  '广州': ['广州白云国际会议中心','广州天河亚朵','广州珠江新城威斯汀','广州猎德如家商务','广州南沙希尔顿'],
}

// ─── 出行目的模板 ──────────────────────────────────────────────────────────
const PURPOSES = [
  '项目需求调研','技术方案评审','里程碑交付评审','客户培训与上线支持',
  '系统部署与联调测试','项目进度汇报','合同谈判','售前技术交流',
  '运维巡检与问题处理','架构设计研讨','用户培训','数据迁移验证',
]

// ─── 航空公司 ──────────────────────────────────────────────────────────────
const AIRLINES = [
  { name: '南方航空', code: 'CZ' },
  { name: '东方航空', code: 'MU' },
  { name: '国航',     code: 'CA' },
  { name: '海航',     code: 'HU' },
  { name: '深航',     code: 'ZH' },
]

// ─── 员工权重（高职级出差多）────────────────────────────────────────────────
const EMP_WEIGHTS = EMPLOYEES.map(e => {
  const code = JG_MAP[e.jobGradeId].code
  const w = code === 'P8' ? 5 : code === 'P7' ? 4 : code === 'P6' ? 3.5 :
            code === 'P5' ? 2.5 : code === 'P4' ? 1.5 : 1
  return { emp: e, weight: w }
})
const TOTAL_WEIGHT = EMP_WEIGHTS.reduce((s, e) => s + e.weight, 0)
function pickEmp() {
  let r = _rand() * TOTAL_WEIGHT
  for (const { emp, weight } of EMP_WEIGHTS) { r -= weight; if (r <= 0) return emp }
  return EMP_WEIGHTS[EMP_WEIGHTS.length - 1].emp
}

// ─── 项目选择（排除本部门所在城市）────────────────────────────────────────
const ACTIVE_PROJS = PROJECTS.filter(p => p.status === '进行中')
function pickProject(homeCity) {
  const valid = ACTIVE_PROJS.filter(p => PROJ_CITY[p.id] !== homeCity)
  return pick(valid.length ? valid : ACTIVE_PROJS)
}

// ─── 月份配置（共220次）──────────────────────────────────────────────────
const MONTHS = [
  { code: '202410', start: '2024-10-01', monthDays: 31, count: 36 },
  { code: '202411', start: '2024-11-01', monthDays: 30, count: 37 },
  { code: '202412', start: '2024-12-01', monthDays: 31, count: 37 },
  { code: '202501', start: '2025-01-01', monthDays: 31, count: 37 },
  { code: '202502', start: '2025-02-01', monthDays: 28, count: 36 },
  { code: '202503', start: '2025-03-01', monthDays: 31, count: 37 },
]

// ─── 持续时间权重 ──────────────────────────────────────────────────────────
const DUR_OPTS    = [1,    2,    3,    4,    5,    6,    7   ]
const DUR_WEIGHTS = [0.08, 0.12, 0.25, 0.25, 0.15, 0.10, 0.05]

function pickDuration() {
  let r = _rand(), cum = 0
  for (let i = 0; i < DUR_OPTS.length; i++) {
    cum += DUR_WEIGHTS[i]
    if (r < cum) return DUR_OPTS[i]
  }
  return 3
}

// ─── 出差状态分布（越晚月份完成比例越低）──────────────────────────────────
function pickStatus(monthIdx) {
  const completedP = monthIdx < 3 ? 0.55 : monthIdx === 3 ? 0.40 : 0.20
  const r = _rand()
  if (r < completedP)              return '已完成'
  if (r < completedP + 0.15)      return '出行中'
  if (r < completedP + 0.32)      return '待审批'
  if (r < completedP + 0.45)      return '已批准'
  return '已拒绝'
}

// ─── 生成主数据 ────────────────────────────────────────────────────────────
const businessTrips  = []
const expenseReports = []
const flightTickets  = []
const trainTickets   = []
const taxiReceipts   = []
const hotelStays     = []

let rptSeq = 0, ftSeq = 0, ttSeq = 0, trSeq = 0, hsSeq = 0

for (let mi = 0; mi < MONTHS.length; mi++) {
  const mc = MONTHS[mi]

  for (let t = 0; t < mc.count; t++) {
    const emp      = pickEmp()
    const homeCity = DEPT_CITY[emp.departmentId]
    const proj     = pickProject(homeCity)
    const destCity = PROJ_CITY[proj.id]
    const grade    = JG_MAP[emp.jobGradeId]

    const days    = pickDuration()
    const dayOff  = ri(0, Math.min(mc.monthDays - days - 1, 22))
    const deptDate = addDays(mc.start, dayOff)
    const retDate  = addDays(deptDate, days)

    const status   = pickStatus(mi)
    const transport = getTransport(homeCity, destCity)

    const ticketCost   = transport === 'flight'
      ? (grade.airClass === '商务舱' ? ri(2500, 5000) : ri(800, 2500))
      : ri(100, 650)
    const nights       = Math.max(0, days - 1)
    const hotelRate    = ri(Math.floor(grade.accommodationLimit * 0.62), grade.accommodationLimit)
    const hotelTotal   = nights * hotelRate
    const mealTotal    = days * grade.dailyMealAllowance
    const budget       = Math.round((ticketCost * 2 + hotelTotal + mealTotal + 200) / 50) * 50

    const tripNo = `BT-${mc.code}-${pad3(t + 1)}`
    const tripId = `TRIP-${mc.code}-${pad3(t + 1)}`

    businessTrips.push({
      id: tripId, tripNo,
      purpose: `${proj.name} - ${pick(PURPOSES)}`,
      departureCity: homeCity, destinationCity: destCity,
      departureDate: deptDate, returnDate: retDate,
      days, status, budgetAmount: budget,
    })

    // 报销单（已完成/出行中/已批准/大部分已拒绝 均提交报销）
    const needReport = status === '已完成' || status === '出行中' || status === '已批准' ||
                       (status === '待审批' && bool(0.25)) ||
                       (status === '已拒绝' && bool(0.85))
    let reportId = null
    if (needReport) {
      rptSeq++
      reportId = `ER-${mc.code}-${pad3(rptSeq)}`
      const totalAmt = Math.round((ticketCost * 2 + hotelTotal + mealTotal + ri(50, 300)) / 10) * 10
      const rStatus = status === '已完成' ? '已付款' :
                      status === '出行中' ? (bool(0.6) ? '审批中' : '草稿') :
                      status === '已批准' ? '已批准' :
                      status === '已拒绝' ? '已拒绝' : '草稿'
      const submittedDate = addDays(retDate, ri(1, 7))
      const rec = { id: reportId, reportNo: reportId, submittedDate, totalAmount: totalAmt, status: rStatus }
      if (rStatus === '已付款' || rStatus === '已批准') rec.approvedAmount = totalAmt
      expenseReports.push(rec)
    }

    // 有票据的条件（排除待审批和已拒绝的早期状态）
    const hasTicket = status !== '待审批' && status !== '已拒绝'

    if (hasTicket) {
      // ── 机票 ──────────────────────────────────────────────────────────────
      if (transport === 'flight') {
        const al       = pick(AIRLINES)
        const seatCls  = grade.airClass === '商务舱' ? '商务舱' : '经济舱'
        const fAmt     = seatCls === '商务舱' ? ri(2500, 5000) : ri(800, 2500)
        const durH     = ri(2, 4)

        ftSeq++
        const dH = ri(6, 19)
        flightTickets.push({
          id: `FT-${pad3(ftSeq)}`, ticketNo: `${al.code}${ri(10000000, 99999999)}`,
          flightNo: `${al.code}${ri(1000, 9999)}`, airline: al.name,
          from: homeCity, to: destCity,
          departureTime: `${deptDate}T${pad2(dH)}:${pick(['00','15','30','45'])}:00`,
          arrivalTime:   `${deptDate}T${pad2(Math.min(dH + durH, 23))}:${pick(['00','15','30','45'])}:00`,
          seatClass: seatCls, amount: fAmt,
        })

        if (status === '已完成') {
          ftSeq++
          const rH = ri(7, 20)
          flightTickets.push({
            id: `FT-${pad3(ftSeq)}`, ticketNo: `${al.code}${ri(10000000, 99999999)}`,
            flightNo: `${al.code}${ri(1000, 9999)}`, airline: al.name,
            from: destCity, to: homeCity,
            departureTime: `${retDate}T${pad2(rH)}:${pick(['00','15','30','45'])}:00`,
            arrivalTime:   `${retDate}T${pad2(Math.min(rH + durH, 23))}:${pick(['00','15','30','45'])}:00`,
            seatClass: seatCls, amount: fAmt,
          })
        }
      }

      // ── 高铁票 ────────────────────────────────────────────────────────────
      if (transport === 'train') {
        const prefix   = pick(['G','G','G','D','D'])
        const seatType = grade.tier === '高档' ? '商务座' : grade.tier === '中档' ? '一等座' : '二等座'
        const tAmt     = ri(100, 650)
        const trainDurH = ri(2, 6)

        ttSeq++
        const dH = ri(6, 19)
        trainTickets.push({
          id: `TT-${pad3(ttSeq)}`, trainNo: `${prefix}${ri(100, 9999)}`,
          from: homeCity, to: destCity,
          departureTime: `${deptDate}T${pad2(dH)}:${pick(['00','15','30','45'])}:00`,
          seatType, amount: tAmt,
        })

        if (status === '已完成') {
          ttSeq++
          const rH = ri(7, 20)
          trainTickets.push({
            id: `TT-${pad3(ttSeq)}`, trainNo: `${prefix}${ri(100, 9999)}`,
            from: destCity, to: homeCity,
            departureTime: `${retDate}T${pad2(rH)}:${pick(['00','15','30','45'])}:00`,
            seatType, amount: tAmt,
          })
        }
      }

      // ── 打车票 ────────────────────────────────────────────────────────────
      const taxiType  = pick(['滴滴','出租车','曹操出行','T3出行'])
      const invType   = pick(['电子发票','行程收据','电子发票'])
      const hub       = transport === 'flight' ? '机场' : '高铁站'

      trSeq++
      taxiReceipts.push({
        id: `TR-${pad3(trSeq)}`, date: deptDate, type: taxiType,
        from: `${homeCity}住所`, to: `${homeCity}${hub}`,
        amount: ri(30, 120), invoiceType: invType,
      })

      if (status === '已完成' || status === '出行中') {
        trSeq++
        taxiReceipts.push({
          id: `TR-${pad3(trSeq)}`, date: deptDate,
          type: pick(['滴滴','出租车','曹操出行']),
          from: `${destCity}${hub}`, to: `${destCity}客户现场`,
          amount: ri(30, 150), invoiceType: pick(['电子发票','行程收据']),
        })
      }

      if (status === '已完成' && days >= 3) {
        trSeq++
        taxiReceipts.push({
          id: `TR-${pad3(trSeq)}`, date: addDays(deptDate, ri(1, days - 1)),
          type: pick(['滴滴','出租车']),
          from: `${destCity}酒店`, to: `${destCity}客户现场`,
          amount: ri(20, 80), invoiceType: pick(['电子发票','行程收据']),
        })
      }

      // ── 住宿 ──────────────────────────────────────────────────────────────
      if (nights > 0) {
        hsSeq++
        const hotelName = pick(HOTELS[destCity] || HOTELS['北京'])
        const nightRate = ri(Math.floor(grade.accommodationLimit * 0.62), grade.accommodationLimit)
        hotelStays.push({
          id: `HS-${pad3(hsSeq)}`, hotelName, city: destCity,
          starRating: grade.tier === '高档' ? 5 : grade.tier === '中档' ? 4 : 3,
          checkIn: deptDate, checkOut: retDate, nights,
          roomType: grade.tier === '高档' ? '豪华大床房' : '标准大床房',
          amountPerNight: nightRate,
          totalAmount: nightRate * nights,
          withinStandard: nightRate <= grade.accommodationLimit,
        })
      }
    }
  }
}

// ─── 写出文件 ──────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(OUT)) await mkdir(OUT, { recursive: true })

  const files = [
    ['01_city.json',          CITIES,         '城市'],
    ['02_company.json',       COMPANY,        '公司'],
    ['03_department.json',    DEPTS,          '部门'],
    ['04_job_grade.json',     JOB_GRADES,     '职级'],
    ['05_employee.json',      EMPLOYEES,      '员工'],
    ['06_project.json',       PROJECTS,       '项目'],
    ['07_business_trip.json', businessTrips,  '出差申请'],
    ['08_expense_report.json',expenseReports, '报销单'],
    ['09_flight_ticket.json', flightTickets,  '机票'],
    ['10_train_ticket.json',  trainTickets,   '高铁票'],
    ['11_taxi_receipt.json',  taxiReceipts,   '打车票'],
    ['12_hotel_stay.json',    hotelStays,     '住宿记录'],
  ]

  let total = 0
  for (const [filename, data, label] of files) {
    await writeFile(`${OUT}/${filename}`, JSON.stringify({ data }, null, 2), 'utf-8')
    console.log(`  ✓ ${filename.padEnd(30)} ${String(data.length).padStart(4)} 条  (${label})`)
    total += data.length
  }
  console.log(`\n  共生成 ${total} 条记录，文件位于 ${OUT}/`)
}

main().catch(e => { console.error(e); process.exit(1) })

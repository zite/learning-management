/**
 * A small, strict CSV reader for spreadsheets people export from HR tools and
 * Excel: a byte-order mark, CRLF or LF line endings, quoted cells containing
 * commas, quotes ("") and line breaks, and semicolon- or tab-separated files.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map(d => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (c === delimiter) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter(r => r.some(cell => cell.trim() !== ''));
  const [headerRow = [], ...rows] = nonEmpty;
  return { headers: headerRow.map(h => h.trim()), rows: rows.map(r => r.map(cell => cell.trim())) };
}

export type ImportField = 'email' | 'name' | 'title' | 'managerEmail' | 'groups' | 'hireDate' | 'externalId' | 'role';

export const IMPORT_FIELDS: Array<{ key: ImportField; label: string; hint: string; required?: boolean; synonyms: string[] }> = [
  { key: 'email', label: 'Email', hint: 'Used to match people who are already here', required: true, synonyms: ['email', 'email address', 'e-mail', 'work email', 'mail', 'business email'] },
  { key: 'name', label: 'Name', hint: 'Filled in from the email when blank', synonyms: ['name', 'full name', 'employee name', 'display name', 'learner', 'person'] },
  { key: 'title', label: 'Job title', hint: '', synonyms: ['title', 'job title', 'position', 'role title', 'job'] },
  { key: 'managerEmail', label: 'Manager email', hint: 'Someone already here, or elsewhere in this file', synonyms: ['manager email', 'manager', 'managers email', 'reports to', 'supervisor email', 'supervisor', 'line manager'] },
  { key: 'groups', label: 'Groups', hint: 'Group names, separated by semicolons', synonyms: ['groups', 'group', 'teams', 'team', 'department', 'departments', 'location'] },
  { key: 'hireDate', label: 'Hire date', hint: 'YYYY-MM-DD or MM/DD/YYYY', synonyms: ['hire date', 'start date', 'date hired', 'hired', 'joined', 'hire_date', 'start'] },
  { key: 'externalId', label: 'Employee ID', hint: 'Your HR system’s ID', synonyms: ['employee id', 'external id', 'id', 'employee number', 'employee no', 'employee', 'emp id', 'emp no', 'staff id', 'staff number', 'badge id', 'personnel number', 'hris id', 'worker id'] },
  { key: 'role', label: 'Role', hint: 'Admin, Instructor or Learner', synonyms: ['role', 'lms role', 'access', 'permission', 'user role'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Match spreadsheet headers to fields by name. Each header is used at most once. */
export function autoMap(headers: string[]): Record<ImportField, number | null> {
  const map = Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, null])) as Record<ImportField, number | null>;
  const used = new Set<number>();
  const normalized = headers.map(norm);
  // Exact synonym matches first, then "contains", so "Manager email" beats "Email" for the manager column.
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of IMPORT_FIELDS) {
      if (map[f.key] != null) continue;
      const idx = normalized.findIndex((h, i) => !used.has(i) && f.synonyms.some(s => (pass === 'exact' ? h === norm(s) : h.includes(norm(s)) && !(f.key === 'email' && h.includes('manager')))));
      if (idx >= 0) {
        map[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return map;
}

export const TEMPLATE_CSV = [
  'name,email,title,manager_email,groups,hire_date,employee_id,role',
  'Jordan Lee,jordan.lee@yourcompany.com,Store Manager,,Retail Stores; People Leaders,2024-03-18,E-1001,Learner',
  'Sam Rivera,sam.rivera@yourcompany.com,Sales Associate,jordan.lee@yourcompany.com,Retail Stores,2026-09-01,E-1044,Learner',
].join('\r\n');

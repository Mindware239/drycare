"use client";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays, CalendarCheck, CalendarOff, Check, Clock3, ContactRound, Mail, MapPin, Pencil, Phone, Plus, Search, ShieldCheck, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { PERMISSIONS } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, PasswordInput, Modal, PageHeader, Select, Spinner, Table, Td, cx } from "@/components/ui";

const DAYS = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"],
] as const;

type DutyDay = { enabled: boolean; start: string; end: string };
type DutySchedule = Record<string, DutyDay>;
type StaffMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  roleKey: string;
  roleName: string;
  branchIds: string[];
  lastLoginAt: string | null;
  phone: string | null;
  address: Record<string, string> | null;
  jobTitle: string | null;
  joiningDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  monthlySalary?: number | null;
  dutySchedule: DutySchedule | null;
  photoUrl: string | null;
};

type AttendanceEntry = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  roleName: string;
  status: "present" | "absent" | "on_leave" | "unrecorded";
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  leaveId: string | null;
  branchId: string;
  workDate: string;
};

type StaffLeave = {
  id: string;
  membershipId: string;
  branchId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: string;
};

const defaultSchedule = (): DutySchedule =>
  Object.fromEntries(DAYS.map(([day]) => [day, { enabled: !["saturday", "sunday"].includes(day), start: "09:00", end: "18:00" }]));

function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function formatWorkDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function EmployeeAvatar({ staff, className }: { staff: Pick<StaffMember, "name" | "photoUrl">; className?: string }) {
  return (
    <span className={cx("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-100", className)}>
      {initials(staff.name)}
      {staff.photoUrl && <img src={staff.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    </span>
  );
}

export default function StaffPage() {
  const { session, branchId } = useSession();
  const staff = useApi<StaffMember[]>("/staff");
  const roles = useApi<any[]>("/roles");
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<StaffMember | null>(null);
  const [leaveEmployee, setLeaveEmployee] = useState<StaffMember | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [showMatrix, setShowMatrix] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"directory" | "attendance">("directory");
  const [attendanceDate, setAttendanceDate] = useState(localDateValue());
  const [attendanceBranchId, setAttendanceBranchId] = useState(branchId);
  const attendance = useApi<AttendanceEntry[]>(activeTab === "attendance" && attendanceBranchId
    ? `/staff/attendance?branchId=${attendanceBranchId}&workDate=${attendanceDate}`
    : null);

  async function patch(id: string, body: any) {
    setErr("");
    try {
      await api(`/staff/${id}`, { method: "PATCH", body });
      staff.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  if (staff.error || roles.error) return <Alert>{staff.error?.message ?? roles.error?.message}</Alert>;
  if (!staff.data || !roles.data) return <Spinner />;

  const roleRows = roles.data;
  const assignableRoles = session.role.key === "owner" ? roleRows : roleRows.filter((role) => role.key !== "owner");
  const visibleStaff = staff.data.filter((person) =>
    `${person.name} ${person.email} ${person.phone ?? ""} ${person.jobTitle ?? ""} ${person.roleName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const activeCount = staff.data.filter((person) => person.status === "active").length;
  const branchCount = new Set(staff.data.flatMap((person) => person.branchIds)).size;
  const presentCount = attendance.data?.filter((person) => person.status === "present").length ?? 0;
  const absentCount = attendance.data?.filter((person) => person.status === "absent").length ?? 0;
  const leaveCount = attendance.data?.filter((person) => person.status === "on_leave").length ?? 0;
  const unrecordedCount = attendance.data?.filter((person) => person.status === "unrecorded").length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff & employees"
        subtitle="View complete employee profiles, manage access, and record attendance or leave."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowMatrix(!showMatrix)}><ShieldCheck className="h-4 w-4" />{showMatrix ? "Hide permissions" : "Role permissions"}</Button>
            <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add employee</Button>
          </>
        }
      />

      <div role="tablist" aria-label="Staff management views" className="dc-tabs flex w-fit max-w-full gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" role="tab" aria-selected={activeTab === "directory"} onClick={() => setActiveTab("directory")} className={cx("inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition", activeTab === "directory" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50")}>
          <Users className="h-4 w-4" />Employee directory
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "attendance"} onClick={() => setActiveTab("attendance")} className={cx("inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition", activeTab === "attendance" ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50")}>
          <CalendarCheck className="h-4 w-4" />Attendance & leave
        </button>
      </div>

      {activeTab === "directory" ? <>
      <section aria-label="Staff overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Team members", value: staff.data.length, note: "Employee accounts", icon: Users, tone: "border-blue-100 bg-blue-50 text-blue-700" },
          { label: "Active accounts", value: activeCount, note: "Can currently sign in", icon: ShieldCheck, tone: "border-emerald-100 bg-emerald-50 text-emerald-700" },
          { label: "Roles in use", value: new Set(staff.data.map((person) => person.roleKey)).size, note: "Access profiles assigned", icon: BriefcaseBusiness, tone: "border-violet-100 bg-violet-50 text-violet-700" },
          { label: "Branch assignments", value: branchCount || (staff.data.length ? "All" : 0), note: "Across your locations", icon: MapPin, tone: "border-amber-100 bg-amber-50 text-amber-700" },
        ].map(({ label, value, note, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">{label}</p>
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl border", tone)}><Icon className="h-[18px] w-[18px]" /></span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      {err && <Alert>{err}</Alert>}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Employee directory</h2>
            <p className="mt-0.5 text-sm text-slate-500">Contact details and account access for your team.</p>
          </div>
          <label className="relative block w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" className="pl-9" />
          </label>
        </div>
        {visibleStaff.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <ContactRound className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-800">{staff.data.length ? "No employees match your search" : "No employees added yet"}</p>
            <p className="mt-1 text-sm text-slate-500">{staff.data.length ? "Try a different name, email, phone, or role." : "Create employee accounts and profiles to manage your team."}</p>
            {!staff.data.length && <Button className="mt-4" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add your first employee</Button>}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table head={["Employee", "Role & branch", "Contact", "Last sign-in", "Account", ""]}>
                {visibleStaff.map((person) => (
                  <tr key={person.membershipId} className="group transition hover:bg-slate-50/70">
                    <Td>
                      <div className="flex min-w-48 items-center gap-3">
                        <EmployeeAvatar staff={person} className="h-10 w-10 text-xs" />
                        <button type="button" onClick={() => setSelected(person)} className="min-w-0 text-left focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                          <span className="block truncate font-semibold text-slate-800 hover:text-brand-700">{person.name}</span>
                          <span className="block truncate text-xs text-slate-500">{person.jobTitle || person.email}</span>
                        </button>
                      </div>
                    </Td>
                    <Td>
                      <Select value={person.roleKey} onChange={(e) => patch(person.membershipId, { roleKey: e.target.value })} className="w-auto max-w-48 py-1.5" disabled={person.userId === session.user.id} aria-label={`Role for ${person.name}`}>
                        {assignableRoles.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
                      </Select>
                      <span className="mt-1 block text-xs text-slate-500">{person.branchIds.length ? person.branchIds.map((id) => session.branches.find((branch) => branch.id === id)?.code ?? "Branch").join(", ") : "All branches"}</span>
                    </Td>
                    <Td>
                      <span className="block text-slate-700">{person.phone || "No phone"}</span>
                      <span className="block max-w-52 truncate text-xs text-slate-500">{person.email}</span>
                    </Td>
                    <Td>{dateTime(person.lastLoginAt)}</Td>
                    <Td>{person.status === "active" ? <Badge color="green">Active</Badge> : <Badge color="red">Suspended</Badge>}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setSelected(person)}><UserRound className="h-3.5 w-3.5" />Details</Button>
                        {person.userId !== session.user.id && <Button size="sm" variant="ghost" onClick={() => patch(person.membershipId, { status: person.status === "active" ? "suspended" : "active" })}>{person.status === "active" ? "Suspend" : "Reactivate"}</Button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="divide-y divide-slate-100 lg:hidden">
              {visibleStaff.map((person) => (
                <li key={person.membershipId} className="p-4">
                  <div className="flex items-start gap-3">
                    <EmployeeAvatar staff={person} className="h-11 w-11 text-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button type="button" onClick={() => setSelected(person)} className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                          <span className="block truncate font-semibold text-slate-900">{person.name}</span>
                          <span className="block truncate text-xs text-slate-500">{person.jobTitle || person.roleName}</span>
                        </button>
                        {person.status === "active" ? <Badge color="green">Active</Badge> : <Badge color="red">Suspended</Badge>}
                      </div>
                      <p className="mt-2 break-all text-xs text-slate-600">
                        {person.phone ? <><span>{person.phone}</span><span className="mx-1 text-slate-300">·</span></> : <span className="text-slate-400">No phone<span className="mx-1 text-slate-300">·</span></span>}
                        {person.email}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{person.branchIds.length ? person.branchIds.map((id) => session.branches.find((branch) => branch.id === id)?.name ?? "Branch").join(", ") : "All branches"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select value={person.roleKey} onChange={(e) => patch(person.membershipId, { roleKey: e.target.value })} className="min-w-0 flex-1 py-1.5" disabled={person.userId === session.user.id} aria-label={`Role for ${person.name}`}>
                      {assignableRoles.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
                    </Select>
                    <Button size="sm" variant="secondary" onClick={() => setSelected(person)}><UserRound className="h-3.5 w-3.5" />Details</Button>
                    {person.userId !== session.user.id && <Button size="sm" variant="ghost" onClick={() => patch(person.membershipId, { status: person.status === "active" ? "suspended" : "active" })}>{person.status === "active" ? "Suspend" : "Reactivate"}</Button>}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">Last sign-in: {dateTime(person.lastLoginAt)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      </> : (
        <section className="space-y-4">
          {attendance.error && <Alert>{attendance.error.message}</Alert>}
          <Card className="p-0">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Daily attendance</h2>
                <p className="mt-1 text-sm text-slate-500">Record attendance manually. No one is marked absent automatically.</p>
              </div>
              <Field label="Branch">
                <Select value={attendanceBranchId} onChange={(e) => setAttendanceBranchId(e.target.value)} className="md:min-w-48">
                  {session.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <Button type="button" variant="secondary" size="sm" aria-label="Previous day" onClick={() => setAttendanceDate((date) => shiftDate(date, -1))}><ArrowLeft className="h-4 w-4" /></Button>
                <Field label="Work date"><Input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} className="w-auto" /></Field>
                <Button type="button" variant="secondary" size="sm" aria-label="Next day" onClick={() => setAttendanceDate((date) => shiftDate(date, 1))}><ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </Card>

          <section aria-label="Selected date attendance summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: "Present", value: presentCount, note: "Attendance recorded", icon: CalendarCheck, tone: "border-emerald-100 bg-emerald-50 text-emerald-700" },
              { label: "Absent", value: absentCount, note: "Manually marked absent", icon: CalendarOff, tone: "border-red-100 bg-red-50 text-red-700" },
              { label: "On leave", value: leaveCount, note: "Covered by leave period", icon: CalendarDays, tone: "border-amber-100 bg-amber-50 text-amber-700" },
              { label: "Not recorded", value: unrecordedCount, note: "Needs a manual update", icon: Clock3, tone: "border-slate-200 bg-slate-50 text-slate-600" },
            ].map(({ label, value, note, icon: Icon, tone }) => (
              <div key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-500">{label}</p><span className={cx("flex h-9 w-9 items-center justify-center rounded-xl border", tone)}><Icon className="h-[18px] w-[18px]" /></span></div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
                <p className="mt-1 text-xs text-slate-500">{note}</p>
              </div>
            ))}
          </section>

          {attendance.loading && !attendance.data ? <Spinner /> : attendance.data?.length ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {attendance.data.map((entry) => (
                <AttendanceCard
                  key={`${entry.membershipId}-${entry.branchId}-${entry.workDate}`}
                  entry={entry}
                  onEmployeeClick={() => setSelected(staff.data?.find((person) => person.membershipId === entry.membershipId) ?? null)}
                  onLeave={() => setLeaveEmployee(staff.data?.find((person) => person.membershipId === entry.membershipId) ?? null)}
                  onRemoveLeave={async () => {
                    if (!entry.leaveId) return;
                    await api(`/staff/leaves/${entry.leaveId}`, { method: "DELETE" });
                    attendance.reload();
                  }}
                  onSaved={() => attendance.reload()}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">No staff assigned to this branch</p>
              <p className="mt-1 text-sm text-slate-500">Select another branch or update employee branch access.</p>
            </div>
          )}
          {err && <Alert>{err}</Alert>}
        </section>
      )}

      {showMatrix && (
        <Card title="Role permission matrix" padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="sticky left-0 z-10 min-w-52 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Permission</th>
                  {roleRows.map((role) => <th key={role.key} className="min-w-28 border-b border-slate-200 px-3 py-3 text-center">{role.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(PERMISSIONS).map(([key, label]) => (
                  <tr key={key} className="hover:bg-slate-50/70">
                    <td className="sticky left-0 border-r border-slate-100 bg-white px-3 py-2.5 font-medium text-slate-700">{label}</td>
                    {roleRows.map((role) => <td key={role.key} className="px-3 py-2.5 text-center">{role.permissions.includes(key) ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-3.5 w-3.5" /></span> : <span className="text-slate-300">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Permissions are checked by the API. Only owners can view or edit employee salary.</p>
        </Card>
      )}
      {adding && <EmployeeForm roles={roleRows} onClose={() => setAdding(false)} onDone={() => { setAdding(false); staff.reload(); }} />}
      {selected && <EmployeeDetails employee={selected} isOwner={session.role.key === "owner"} branchNames={session.branches} onEdit={() => { setEditingEmployee(selected); setSelected(null); }} onClose={() => setSelected(null)} onRecordLeave={() => { const employee = selected; if (employee.branchIds[0]) setAttendanceBranchId(employee.branchIds[0]); setActiveTab("attendance"); setLeaveEmployee(employee); setSelected(null); }} />}
      {editingEmployee && <EmployeeForm roles={roleRows} employee={editingEmployee} onClose={() => setEditingEmployee(null)} onDone={() => { setEditingEmployee(null); staff.reload(); }} />}
      {leaveEmployee && attendanceBranchId && <LeaveForm employee={leaveEmployee} branchId={attendanceBranchId} onClose={() => setLeaveEmployee(null)} onDone={() => { setLeaveEmployee(null); attendance.reload(); }} />}
    </div>
  );
}

function EmployeeDetails({
  employee,
  isOwner,
  branchNames,
  onEdit,
  onClose,
  onRecordLeave,
}: {
  employee: StaffMember;
  isOwner: boolean;
  branchNames: { id: string; name: string; code: string }[];
  onEdit: () => void;
  onClose: () => void;
  onRecordLeave: () => void;
}) {
  const leaves = useApi<StaffLeave[]>(`/staff/${employee.membershipId}/leaves`);
  const address = employee.address;
  const addressText = address
    ? [address.line1, address.locality, address.city, address.state, address.pincode].filter(Boolean).join(", ")
    : "";
  const branchText = employee.branchIds.length
    ? employee.branchIds.map((id) => branchNames.find((branch) => branch.id === id)?.name ?? "Branch").join(", ")
    : "All branches";

  return (
    <Modal
      open
      wide
      title="Employee details"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onRecordLeave}><CalendarDays className="h-4 w-4" />Record leave</Button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={onEdit}><Pencil className="h-4 w-4" />Edit profile</Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto overscroll-contain pr-1">
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
          <EmployeeAvatar staff={employee} className="h-16 w-16 text-lg" />
          <div className="min-w-[14rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-950">{employee.name}</h3>
              {employee.status === "active" ? <Badge color="green">Active account</Badge> : <Badge color="red">Suspended</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-600">{employee.jobTitle || employee.roleName} · {employee.roleName}</p>
            <p className="mt-1 text-xs text-slate-500">{branchText}</p>
          </div>
          <div className="text-left text-xs text-slate-500 sm:text-right">
            <p>Joined {formatWorkDate(employee.joiningDate)}</p>
            <p className="mt-1">Last sign-in {dateTime(employee.lastLoginAt)}</p>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <DetailSection title="Contact & address" icon={ContactRound}>
            <DetailLine icon={Mail} label="Email" value={employee.email} />
            <DetailLine icon={Phone} label="Mobile" value={employee.phone} />
            <DetailLine icon={MapPin} label="Home address" value={addressText} />
          </DetailSection>
          <DetailSection title="Emergency contact" icon={AlertTriangle}>
            <DetailLine icon={UserRound} label="Contact" value={employee.emergencyContactName} />
            <DetailLine icon={Phone} label="Mobile" value={employee.emergencyContactPhone} />
          </DetailSection>
          <DetailSection title="Employment" icon={BriefcaseBusiness}>
            <DetailLine icon={BriefcaseBusiness} label="Job title" value={employee.jobTitle} />
            <DetailLine icon={ShieldCheck} label="Access role" value={employee.roleName} />
            <DetailLine icon={MapPin} label="Branch access" value={branchText} />
            {isOwner && <DetailLine icon={Check} label="Monthly salary" value={employee.monthlySalary == null ? "Not set" : money(employee.monthlySalary)} />}
          </DetailSection>
          <DetailSection title="Weekly duty schedule" icon={CalendarDays}>
            {DAYS.map(([day, label]) => {
              const shift = employee.dutySchedule?.[day];
              return <DetailLine key={day} icon={Clock3} label={label} value={shift?.enabled ? `${shift.start} – ${shift.end}` : "Day off"} />;
            })}
          </DetailSection>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Leave history</h4>
              <p className="mt-0.5 text-xs text-slate-500">Recorded leave periods for this employee.</p>
            </div>
            {leaves.loading && <span className="text-xs text-slate-400">Loading…</span>}
          </div>
          {leaves.error ? <Alert>{leaves.error.message}</Alert> : leaves.data?.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {leaves.data.map((leave) => (
                <li key={leave.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{formatWorkDate(leave.startDate)}{leave.startDate !== leave.endDate ? ` – ${formatWorkDate(leave.endDate)}` : ""}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{leave.reason || "No reason provided"} · {branchNames.find((branch) => branch.id === leave.branchId)?.name ?? "Branch"}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : !leaves.loading && <p className="mt-3 text-sm text-slate-500">No leave periods recorded.</p>}
        </section>
      </div>
    </Modal>
  );
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon className="h-4 w-4 text-brand-700" />{title}</h4>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function DetailLine({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="break-words text-sm text-slate-700">{value || "Not provided"}</p>
      </div>
    </div>
  );
}

function AttendanceCard({
  entry,
  onEmployeeClick,
  onLeave,
  onRemoveLeave,
  onSaved,
}: {
  entry: AttendanceEntry;
  onEmployeeClick: () => void;
  onLeave: () => void;
  onRemoveLeave: () => Promise<void>;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<AttendanceEntry["status"]>(entry.status);
  const [checkIn, setCheckIn] = useState(entry.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(entry.checkOut ?? "");
  const [note, setNote] = useState(entry.note ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingLeave, setRemovingLeave] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const canEditAttendance = status !== "on_leave";

  async function saveAttendance() {
    if (status !== "present" && status !== "absent") return;
    setSaving(true);
    setError("");
    try {
      await api("/staff/attendance", {
        method: "PUT",
        body: {
          membershipId: entry.membershipId,
          branchId: entry.branchId,
          workDate: entry.workDate,
          status,
          checkIn: status === "present" ? checkIn || undefined : undefined,
          checkOut: status === "present" ? checkOut || undefined : undefined,
          note: note.trim() || undefined,
        },
      });
      onSaved();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeLeave() {
    setRemovingLeave(true);
    setLeaveError("");
    try {
      await onRemoveLeave();
    } catch (e) {
      setLeaveError((e as ApiError).message);
    } finally {
      setRemovingLeave(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <EmployeeAvatar staff={{ name: entry.name, photoUrl: null }} className="h-11 w-11 text-sm" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onEmployeeClick} className="text-left font-semibold text-slate-900 hover:text-brand-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{entry.name}</button>
          <p className="mt-0.5 truncate text-xs text-slate-500">{entry.jobTitle || entry.roleName} · {entry.phone || entry.email}</p>
        </div>
        {status === "present" ? <Badge color="green">Present</Badge> : status === "absent" ? <Badge color="red">Absent</Badge> : status === "on_leave" ? <Badge color="amber">On leave</Badge> : <Badge color="slate">Not recorded</Badge>}
      </div>

      {status === "on_leave" ? (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
          <p className="text-sm font-medium text-amber-900">On leave for this date</p>
          <p className="mt-1 text-xs text-amber-800">{entry.note || "No reason provided"}</p>
          {leaveError && <p className="mt-2 text-xs text-red-700">{leaveError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onEmployeeClick}><UserRound className="h-3.5 w-3.5" />Employee details</Button>
            {entry.leaveId && <Button size="sm" variant="ghost" disabled={removingLeave} onClick={removeLeave}>{removingLeave ? "Removing…" : "Remove leave record"}</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Attendance status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as AttendanceEntry["status"])}>
                <option value="unrecorded">Not recorded</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </Select>
            </Field>
            {status === "present" && <>
              <Field label="Check-in time"><Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></Field>
              <Field label="Check-out time"><Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></Field>
            </>}
            <Field label="Note (optional)" className={status === "present" ? "sm:col-span-2" : ""}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a short note" /></Field>
          </div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="secondary" onClick={onLeave}><CalendarDays className="h-3.5 w-3.5" />Record leave</Button>
            <Button size="sm" disabled={!canEditAttendance || saving} onClick={saveAttendance}><Check className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save attendance"}</Button>
          </div>
        </>
      )}
    </article>
  );
}

function LeaveForm({ employee, branchId, onClose, onDone }: { employee: StaffMember; branchId: string; onClose: () => void; onDone: () => void }) {
  const today = localDateValue();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    if (endDate < startDate) {
      setError("Leave end date must be on or after its start date.");
      return;
    }
    setSaving(true);
    try {
      await api("/staff/leaves", {
        method: "POST",
        body: { membershipId: employee.membershipId, branchId, startDate, endDate, reason: reason.trim() || undefined },
      });
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`Record leave · ${employee.name}`}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={save}><CalendarDays className="h-4 w-4" />{saving ? "Saving…" : "Save leave"}</Button></>}
    >
      <p className="text-sm text-slate-600">The employee will appear as on leave for each selected date at this branch. Existing attendance may need correction before leave can be recorded.</p>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start date" required><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End date" required><Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>
      <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Annual leave" /></Field>
    </Modal>
  );
}

function EmployeeForm({ roles, employee, onClose, onDone }: { roles: any[]; employee?: StaffMember; onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const isOwner = session.role.key === "owner";
  const assignableRoles = isOwner ? roles : roles.filter((role) => role.key !== "owner");
  const [form, setForm] = useState(() => ({
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    password: "",
    roleKey: employee?.roleKey ?? "reception",
    branchIds: employee?.branchIds ?? [],
    phone: employee?.phone ?? "",
    address: {
      line1: employee?.address?.line1 ?? "",
      locality: employee?.address?.locality ?? "",
      city: employee?.address?.city ?? "",
      state: employee?.address?.state ?? "",
      pincode: employee?.address?.pincode ?? "",
    },
    jobTitle: employee?.jobTitle ?? "",
    joiningDate: employee?.joiningDate ?? "",
    emergencyContactName: employee?.emergencyContactName ?? "",
    emergencyContactPhone: employee?.emergencyContactPhone ?? "",
    monthlySalary: employee?.monthlySalary == null ? "" : (employee.monthlySalary / 100).toFixed(2),
  }));
  const [schedule, setSchedule] = useState<DutySchedule>(() => employee ? { ...(employee.dutySchedule ?? {}) } : defaultSchedule());
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdMembershipId, setCreatedMembershipId] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);

  function setDuty(day: string, value: Partial<DutyDay>) {
    setSchedule((current) => ({ ...current, [day]: { ...(current[day] ?? { enabled: false, start: "09:00", end: "18:00" }), ...value } }));
  }

  async function photoPayload(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP photo.");
    if (file.size > 600_000) throw new Error("Photo must be 600 KB or smaller.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected photo."));
      reader.onerror = () => reject(new Error("Could not read the selected photo."));
      reader.readAsDataURL(file);
    });
    return { mimeType: file.type, data: dataUrl.split(",")[1] };
  }

  async function save() {
    setErr("");
    setSaving(true);
    try {
      let membershipId = employee?.membershipId ?? createdMembershipId;
      if (!employee && !membershipId) {
        const salary = form.monthlySalary.trim() ? rupeesToPaise(form.monthlySalary) : undefined;
        if (form.monthlySalary.trim() && (!Number.isSafeInteger(salary) || salary! < 0)) throw new Error("Enter a valid monthly salary.");
        const result = await api<{ membershipId: string }>("/staff", {
          body: {
            name: form.name,
            email: form.email,
            password: form.password,
            roleKey: form.roleKey,
            branchIds: form.branchIds,
            phone: form.phone.trim() || undefined,
            address: Object.values(form.address).some(Boolean) ? form.address : undefined,
            jobTitle: form.jobTitle.trim() || undefined,
            joiningDate: form.joiningDate || undefined,
            emergencyContactName: form.emergencyContactName.trim() || undefined,
            emergencyContactPhone: form.emergencyContactPhone.trim() || undefined,
            ...(isOwner ? { monthlySalary: salary } : {}),
            dutySchedule: schedule,
          },
        });
        membershipId = result.membershipId;
        setCreatedMembershipId(membershipId);
      } else if (employee && !profileSaved) {
        const salary = form.monthlySalary.trim() ? rupeesToPaise(form.monthlySalary) : null;
        if (isOwner && form.monthlySalary.trim() && (!Number.isSafeInteger(salary) || salary! < 0)) throw new Error("Enter a valid monthly salary.");
        await api(`/staff/${employee.membershipId}/profile`, {
          method: "PATCH",
          body: {
            name: form.name,
            phone: form.phone.trim() || null,
            address: Object.values(form.address).some(Boolean) ? form.address : null,
            jobTitle: form.jobTitle.trim() || null,
            joiningDate: form.joiningDate || null,
            emergencyContactName: form.emergencyContactName.trim() || null,
            emergencyContactPhone: form.emergencyContactPhone.trim() || null,
            ...(isOwner ? { monthlySalary: salary } : {}),
            dutySchedule: schedule,
          },
        });
        setProfileSaved(true);
      }

      if (!membershipId) throw new Error("Employee record was not created. Try again.");
      if (photo && !photoSaved) {
        await api(`/staff/${membershipId}/photo`, { method: "PUT", body: await photoPayload(photo) });
        setPhotoSaved(true);
      } else if (removePhoto && employee?.photoUrl && !photoSaved) {
        await api(`/staff/${membershipId}/photo`, { method: "DELETE" });
        setPhotoSaved(true);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  const accountCreated = !!createdMembershipId;
  const title = employee ? `Employee profile · ${employee.name}` : accountCreated ? "Finish employee profile" : "Add employee";
  const canSubmit = employee ? form.name.trim().length >= 2 : accountCreated || (form.name.trim().length >= 2 && !!form.email.trim() && form.password.length >= 10);

  return (
    <Modal
      open
      wide
      title={title}
      onClose={() => { if (accountCreated) onDone(); else onClose(); }}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-xs text-slate-500 sm:block">Employee data is restricted to staff managers. Salary is owner-only.</p>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => { if (accountCreated) onDone(); else onClose(); }}>Close</Button>
            <Button onClick={save} loading={saving} disabled={!canSubmit}>{accountCreated ? "Retry photo upload" : employee ? "Save profile" : "Create employee"}</Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[65vh] space-y-5 overflow-y-auto overscroll-contain pr-2">
        {err && <Alert>{accountCreated ? `Employee account was created. ${err}` : err}</Alert>}
        {!employee && !accountCreated && (
          <section className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><ShieldCheck className="h-4 w-4 text-brand-700" />Sign-in & access</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>
              <Field label="Email (sign-in ID)" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
              <Field label="Initial password" required hint="At least 10 characters. Share it with the employee in person."><PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="Role">
                <Select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                  {assignableRoles.map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
                </Select>
              </Field>
            </div>
            {session.branches.length > 1 && (
              <Field label="Branch access" hint="Leave all unticked to allow access to every branch." className="mt-3">
                <div className="flex flex-wrap gap-3">
                  {session.branches.map((branch) => (
                    <label key={branch.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <input type="checkbox" checked={form.branchIds.includes(branch.id)} onChange={(e) => setForm({ ...form, branchIds: e.target.checked ? [...form.branchIds, branch.id] : form.branchIds.filter((id) => id !== branch.id) })} />
                      {branch.name}
                    </label>
                  ))}
                </div>
              </Field>
            )}
          </section>
        )}

        {(employee || accountCreated) && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <EmployeeAvatar staff={{ name: form.name || employee?.name || "Employee", photoUrl: employee?.photoUrl ?? null }} className="h-12 w-12 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{form.name || employee?.name}</p>
              <p className="truncate text-xs text-slate-500">{employee?.email}</p>
            </div>
            {employee?.status && (employee.status === "active" ? <Badge color="green">Active account</Badge> : <Badge color="red">Suspended</Badge>)}
          </div>
        )}

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><UserRound className="h-4 w-4 text-brand-700" />Employee details</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(employee || accountCreated) && <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></Field>}
            <Field label="Job title"><Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. Pressing operator" /></Field>
            <Field label="Joining date"><Input type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} /></Field>
            <Field label="Mobile number"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></Field>
            {isOwner && <Field label="Monthly salary (₹)" hint="Private to the business owner. Stored as INR paise."><Input type="number" min="0" step="0.01" value={form.monthlySalary} onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })} inputMode="decimal" placeholder="Not set" /></Field>}
            <Field label="Employee photo" hint="JPG, PNG, or WebP up to 600 KB. Stored privately in the business database.">
              <Input type="file" accept="image/jpeg,image/png,image/webp" className="px-2 py-1.5 text-xs" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setRemovePhoto(false); setPhotoSaved(false); }} />
              {employee?.photoUrl && !removePhoto && !photo && <button type="button" onClick={() => { setRemovePhoto(true); setPhotoSaved(false); }} className="mt-1 text-xs font-medium text-red-600 hover:text-red-700">Remove current photo</button>}
              {removePhoto && <p className="mt-1 text-xs text-amber-700">Current photo will be removed when you save.</p>}
            </Field>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><MapPin className="h-4 w-4 text-brand-700" />Home address</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Address line" className="sm:col-span-2"><Input value={form.address.line1} onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })} autoComplete="street-address" /></Field>
            <Field label="Locality"><Input value={form.address.locality} onChange={(e) => setForm({ ...form, address: { ...form.address, locality: e.target.value } })} /></Field>
            <Field label="City"><Input value={form.address.city} onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })} autoComplete="address-level2" /></Field>
            <Field label="State"><Input value={form.address.state} onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })} autoComplete="address-level1" /></Field>
            <Field label="PIN code"><Input value={form.address.pincode} onChange={(e) => setForm({ ...form, address: { ...form.address, pincode: e.target.value } })} autoComplete="postal-code" /></Field>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-600" />Emergency contact <span className="font-normal text-slate-400">· optional</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact name"><Input value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></Field>
            <Field label="Contact phone"><Input type="tel" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></Field>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-brand-700" />Weekly duty schedule</div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="hidden grid-cols-[90px_1fr_1fr] gap-3 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid"><span>Day</span><span>Start time</span><span>End time</span></div>
            <div className="divide-y divide-slate-100">
              {DAYS.map(([day, label]) => {
                const shift = schedule[day] ?? { enabled: false, start: "09:00", end: "18:00" };
                return (
                  <div key={day} className={cx("grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[90px_1fr_1fr] sm:gap-3", !shift.enabled && "bg-slate-50/50")}>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={shift.enabled} onChange={(e) => setDuty(day, { enabled: e.target.checked })} />
                      {label}
                    </label>
                    {shift.enabled ? (
                      <>
                        <Input type="time" aria-label={`${label} start time`} value={shift.start} onChange={(e) => setDuty(day, { start: e.target.value })} className="w-auto py-1.5" />
                        <Input type="time" aria-label={`${label} end time`} value={shift.end} onChange={(e) => setDuty(day, { end: e.target.value })} className="col-start-2 w-auto py-1.5 sm:col-start-auto" />
                      </>
                    ) : <span className="col-start-2 text-xs text-slate-400 sm:col-start-2 sm:col-span-2">Day off</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />This records the planned weekly schedule; it does not track attendance or calculate payroll.</p>
        </section>

        {accountCreated && <Alert tone="green">Employee account and profile are saved. Retry the photo upload or close this form to return to the directory.</Alert>}
      </div>
    </Modal>
  );
}

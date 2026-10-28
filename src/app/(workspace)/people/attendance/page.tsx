import type { Metadata } from "next";
import { AttendanceView } from "@/features/people/attendance";

export const metadata: Metadata = { title: "Attendance & Leave" };

export default function PeopleAttendancePage() {
  return <AttendanceView />;
}

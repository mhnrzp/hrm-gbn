"use client";
import { useState } from "react";
import { CalendarCheck, CircleAlert, ListChecks, Plus, Receipt } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, LoadingState, PageTitle, StatCard, Table, Td, Th } from "@/components/ui/primitives";
import { DateField, ErrorState, Modal, Segmented, SelectField, TextAreaField, TextField, TimeField, Toggle } from "@/components/ui/controls";
import { faNumber } from "@/lib/format";

// Labels below are UI-kit specimens copied from the Figma foundations board, not application data.
export function UiKitPreview() {
  const [toggle, setToggle] = useState(true);
  const [modal, setModal] = useState(false);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [date, setDate] = useState("2026-10-19");
  const [time, setTime] = useState("17:00");

  return (
    <AppShell user={{ id: "preview", fullName: "علی رضایی", avatarUrl: null, role: "manager" }} unreadCount={3} todayLabel="شنبه، ۲۵ مهر ۱۴۰۵">
      <PageTitle title="کیت رابط کاربری" subtitle="پیش‌نمایش توسعه — فقط در محیط توسعه" actions={<Button icon={Plus}>تسک جدید</Button>} />

      <div className="flex flex-col gap-3.5 md:flex-row">
        <StatCard value={faNumber(5)} label="تسک‌های انجام‌نشده" icon={ListChecks} tone="blue" />
        <StatCard value={faNumber(2)} label="تسک‌های عقب‌افتاده" icon={CircleAlert} tone="red" />
        <StatCard value={faNumber(1)} label="صورت‌حساب‌های سررسیدشده" icon={Receipt} tone="purple" />
        <StatCard value={faNumber(1)} label="مرخصی‌های امروز" icon={CalendarCheck} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="دکمه‌ها" />
          <div className="flex flex-wrap gap-2 p-4">
            <Button>اصلی</Button>
            <Button variant="secondary">ثانویه</Button>
            <Button variant="danger">حذف</Button>
            <Button variant="ghost">عادی</Button>
            <Button disabled>غیرفعال</Button>
          </div>
          <CardHeader title="اولویت و وضعیت" />
          <div className="flex flex-wrap gap-2 p-4">
            <Badge tone="blue">عادی</Badge>
            <Badge tone="amber">مهم</Badge>
            <Badge tone="red">فوری</Badge>
            <Badge tone="gray">انجام‌نشده</Badge>
            <Badge tone="blue">در حال انجام</Badge>
            <Badge tone="green">تکمیل‌شده</Badge>
            <Badge tone="amber">پرداخت‌نشده</Badge>
            <Badge tone="green">پرداخت‌شده</Badge>
            <Badge tone="red">سررسید گذشته</Badge>
            <Badge tone="purple">جلسه</Badge>
          </div>
          <div className="flex items-center gap-3 p-4">
            <Avatar name="سارا محمدی" seed="a" />
            <Avatar name="علی رضایی" seed="b" size={40} />
            <Segmented value={view} onChange={setView} options={[{ value: "list", label: "فهرست" }, { value: "kanban", label: "کانبان" }]} />
          </div>
        </Card>

        <Card>
          <CardHeader title="ورودی، انتخاب و جستجو" />
          <div className="flex flex-col gap-3 p-4">
            <TextField label="ورودی متن" placeholder="عنوان را وارد کنید" />
            <SelectField label="انتخاب مسئول" options={[{ value: "1", label: "سارا محمدی" }]} />
            <div className="grid grid-cols-2 gap-2.5">
              <DateField label="تاریخ" value={date} onChange={setDate} />
              <TimeField label="ساعت" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <TextField label="مبلغ" defaultValue="۰ تومان" error="مبلغ باید بیشتر از صفر باشد." />
            <TextAreaField label="توضیحات" placeholder="شرح کار را وارد کنید." />
            <Toggle label="یادآوری فعال" checked={toggle} onChange={setToggle} />
            <Toggle label="خلاصه هفتگی تیم" description="شنبه‌ها، ساعت ۰۸:۰۰" checked={!toggle} onChange={(v) => setToggle(!v)} />
            <Button variant="secondary" onClick={() => setModal(true)}>
              باز کردن پنجره فرم
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="نمونه سرستون و ردیف" />
        <Table>
          <thead>
            <tr>
              <Th>عنوان تسک</Th>
              <Th>اولویت</Th>
              <Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>طراحی صفحه لندینگ</Td>
              <Td>
                <Badge tone="amber">مهم</Badge>
              </Td>
              <Td>
                <Badge tone="blue">در حال انجام</Badge>
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="حالت‌های سیستمی" />
        <LoadingState />
        <EmptyState message="هنوز تسکی ثبت نشده است. اولین کار تیم را ایجاد کنید." action={<Button icon={Plus}>تسک جدید</Button>} />
        <ErrorState onRetry={() => undefined} />
        <div className="flex flex-col gap-2 p-4">
          <Alert tone="amber" title="۱ هم‌پوشانی در برنامه">جلسه بازبینی با زمان طراحی صفحه لندینگ تداخل دارد.</Alert>
          <Alert tone="green" title="این بازه بدون تداخل است">۳ ساعت زمان آزاد به برنامه اضافه می‌شود.</Alert>
          <Alert tone="blue" title="دسترسی پیش‌فرض: کارمند">عضو جدید فقط تسک‌ها و برنامه شخصی خود را مدیریت می‌کند.</Alert>
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="نمونه پنجره فرم"
        subtitle="مشخصات کار را وارد کنید."
        footer={
          <>
            <Button onClick={() => setModal(false)}>ذخیره</Button>
            <Button variant="secondary" onClick={() => setModal(false)}>
              انصراف
            </Button>
          </>
        }
      >
        <TextField label="عنوان" placeholder="عنوان را وارد کنید" />
      </Modal>
    </AppShell>
  );
}

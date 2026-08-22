import { JobForm } from "@/components/job-form";

export const metadata = { title: "New job" };

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Create a job</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the job description and set your scoring rubric. You can tweak
          the weights and re-score any time later.
        </p>
      </div>
      <JobForm />
    </div>
  );
}

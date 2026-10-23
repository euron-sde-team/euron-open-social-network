import { TwoColumn } from "@/components/shell/layouts";
import { QuestionDetail } from "@/components/questions/question-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TwoColumn max="max-w-3xl">
      <QuestionDetail id={id} />
    </TwoColumn>
  );
}

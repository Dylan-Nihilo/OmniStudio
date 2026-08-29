import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@/lib/i18n";

export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh" messages={getMessages("zh")} timeZone="Asia/Shanghai">
      {ui}
    </NextIntlClientProvider>,
  );
}

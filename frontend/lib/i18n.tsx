"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "hi";

// Core-surface dictionary. t(key, fallback) always renders fallback English
// when a translation is missing, so adoption is progressive and never blank.
const STRINGS: Record<Lang, Record<string, string>> = {
  en: {},
  hi: {
    "nav.dashboard": "डैशबोर्ड",
    "nav.cases": "मामले",
    "nav.search": "खोजें",
    "nav.alerts": "अलर्ट",
    "nav.login": "लॉगिन",
    "login.title": "जांचकर्ता लॉगिन",
    "login.signin": "साइन इन",
    "login.signing": "साइन इन हो रहा…",
    "login.username": "उपयोगकर्ता नाम",
    "login.password": "पासवर्ड",
    "login.code": "प्रमाणीकरण कोड",
    "login.verify": "सत्यापित करें",
    "login.need2fa": "दो-चरणीय कोड दर्ज करें",
    "login.choose": "अपना लॉगिन चुनें",
    "login.chooseSub": "हर दरवाज़ा आपके खाते की भूमिका जांचता है — गलत दरवाज़ा आपको अस्वीकार कर देगा।",
    "login.doorSho": "SHO / पर्यवेक्षक के रूप में लॉगिन",
    "login.doorShoSub": "मामले अपने पास रखें, जांचकर्ता नियुक्त करें, मर्ज स्वीकृत करें",
    "login.doorInv": "जांचकर्ता के रूप में लॉगिन",
    "login.doorInvSub": "सौंपे गए मामलों पर काम करें, एंटिटी सत्यापित करें, ग्राफ़ देखें",
    "login.demoSho": "पर्यवेक्षक के रूप में जारी रखें (डेमो) →",
    "login.demoInv": "जांचकर्ता के रूप में जारी रखें (डेमो) →",
    "login.as": "के रूप में लॉगिन हो रहा है",
    "login.notyou": "आप नहीं हैं?",
    "login.back": "← वापस जाएं",
    "my.title": "मेरे मामले",
    "my.sub": "आपके SHO द्वारा आपको सौंपे गए मामले। नए कार्यभार अपने आप दिखते हैं।",
    "team.title": "केस टीम",
    "team.sub": "जांचकर्ताओं को view, edit या admin पहुंच के साथ नियुक्त करें। वे केस तुरंत देख पाएंगे।",
    "team.pick": "जांचकर्ता चुनें…",
    "team.assign": "नियुक्त करें",
    "dash.title": "कमांड डैशबोर्ड",
    "dash.active": "सक्रिय मामले",
    "dash.highrisk": "उच्च जोखिम",
    "dash.pending": "समीक्षा लंबित",
    "dash.jurisdiction": "अधिकार क्षेत्र के मामले",
    "dash.open": "मामले खोलें",
    "dash.crosscase": "अंतर-मामला संबंध",
    "dash.district": "जिला अवलोकन",
    "case.graph": "ग्राफ़ एक्सप्लोरर",
    "case.evidence": "साक्ष्य",
    "case.review": "AI समीक्षा कतार",
    "case.analytics": "नेटवर्क विश्लेषण",
    "case.copilot": "जांच सहायक",
    "case.geo": "भू-स्थानिक",
    "case.reports": "रिपोर्ट",
    "case.workflow": "कार्य व सहयोग",
    "case.rebuild": "ग्राफ़ पुनर्निर्माण",
    "review.entities": "एंटिटी",
    "review.relations": "संबंध",
    "review.merges": "विलय सुझाव",
    "review.confirm": "पुष्टि",
    "review.reject": "अस्वीकार",
    "review.approve": "स्वीकृत",
    "evidence.intake": "साक्ष्य प्राप्ति",
    "evidence.upload": "फ़ाइलें अपलोड करें",
    "evidence.drop": "फ़ाइलें यहाँ खींचें और छोड़ें, या",
    "copilot.ask": "पूछें",
    "copilot.placeholder": "सहायक से पूछें…",
    "common.loading": "लोड हो रहा…",
    "common.save": "सहेजें",
    "common.cancel": "रद्द करें",
    "common.delete": "हटाएं",
    "common.download": "डाउनलोड",
    "common.close": "बंद करें",
    "common.search": "खोजें",
    "common.empty": "अभी कुछ नहीं।",
    "security.title": "दो-चरणीय प्रमाणीकरण",
    "security.on": "सक्षम",
    "security.off": "अक्षम",
    "icjs.title": "ICJS से आयात करें",
    "icjs.subtitle": "बाहरी केस बंडल खींचें — वही पाइपलाइन चलेगी",
    "icjs.pick": "ICJS केस चुनें…",
    "icjs.import": "केस आयात करें",
    "icjs.importing": "आयात हो रहा…",
    "icjs.reviewLink": "समीक्षा कतार खोलें →",
  },
};

type I18n = { lang: Lang; setLang: (l: Lang) => void; t: (key: string, fallback: string) => string };

const Ctx = createContext<I18n>({ lang: "en", setLang: () => {}, t: (_k, fb) => fb });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem("pramaan_lang");
    if (saved === "hi" || saved === "en") setLangState(saved);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    window.localStorage.setItem("pramaan_lang", l);
  }

  function t(key: string, fallback: string) {
    return STRINGS[lang][key] ?? fallback;
  }

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      className="rounded-lg border border-ink-700 px-2 py-1 text-xs hover:border-accent"
      title="Language / भाषा"
      onClick={() => setLang(lang === "en" ? "hi" : "en")}
    >
      {lang === "en" ? "EN · हिं" : "हिं · EN"}
    </button>
  );
}

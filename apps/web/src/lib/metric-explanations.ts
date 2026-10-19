import { isDailyReportChartMetric, type DailyReportChartMetric } from "@/lib/daily-report-chart-preferences";
import { tr, type AppLocale } from "@/lib/locale";

/** TCK-156: fixed "what is it and why it matters" text for each goal-bar
 * metric, shown as a separate local-only Daffy bubble after the TCK-41
 * "where it comes from" answer. Plain text - no markdown, no newlines. */
export const METRIC_EXPLANATIONS: Record<DailyReportChartMetric, { en: string; he: string }> = {
  calories: {
    en: "Calories are the energy your body gets from food and drink - it runs on them for everything from breathing to exercise. Staying close to your target supports a steady weight: a regular surplus is stored as fat, while a large deficit can leave you tired and cost muscle.",
    he: "קלוריות הן האנרגיה שהגוף מקבל ממזון ומשתייה, והוא משתמש בה לכל דבר - מנשימה ועד פעילות גופנית. שמירה קרובה ליעד תומכת במשקל יציב: עודף קבוע נאגר כשומן, וחוסר גדול עלול לגרום לעייפות ולאובדן שריר.",
  },
  protein: {
    en: "Protein is the building material for muscles, skin, enzymes and immune cells. Getting enough helps keep muscle mass (especially when losing weight), aids recovery after exercise, and keeps you full for longer.",
    he: "חלבון הוא חומר הבנייה של השרירים, העור, האנזימים ותאי מערכת החיסון. צריכה מספקת עוזרת לשמור על מסת שריר (במיוחד בירידה במשקל), תורמת להתאוששות אחרי אימון ומאריכה את תחושת השובע.",
  },
  carbs: {
    en: "Carbohydrates are the body's main and quickest source of energy, and the brain's preferred fuel. Whole grains, legumes, fruit and vegetables provide them along with fiber and steadier energy than refined sugar and white flour.",
    he: "פחמימות הן מקור האנרגיה העיקרי והמהיר של הגוף, והדלק המועדף על המוח. דגנים מלאים, קטניות, פירות וירקות מספקים אותן יחד עם סיבים ואנרגיה יציבה יותר מסוכר ומקמח לבן.",
  },
  fats: {
    en: "Fat is essential for absorbing vitamins A, D, E and K, for hormone production and for healthy cells. Unsaturated fats (olive oil, nuts, avocado, fish) are the preferred kind; fat is also calorie-dense, so portions add up quickly.",
    he: "שומן חיוני לספיגת ויטמינים A, D, E ו-K, לייצור הורמונים ולבריאות התאים. עדיף שומן בלתי רווי (שמן זית, אגוזים, אבוקדו, דגים); שומן עתיר קלוריות, ולכן מנות מצטברות מהר.",
  },
  fiber: {
    en: "Dietary fiber supports regular digestion and feeds healthy gut bacteria. It also helps you feel full, slows sugar absorption and helps lower cholesterol.",
    he: "סיבים תזונתיים תומכים בעיכול סדיר ומזינים את חיידקי המעי הטובים. הם גם תורמים לתחושת שובע, מאטים את ספיגת הסוכר ועוזרים להוריד כולסטרול.",
  },
  water: {
    en: "Water makes up more than half of body weight and is needed for temperature control, blood circulation, digestion and kidney function. Even mild dehydration can cause fatigue, headaches and reduced concentration.",
    he: "מים מהווים יותר ממחצית ממשקל הגוף ונחוצים לוויסות החום, למחזור הדם, לעיכול ולתפקוד הכליות. גם התייבשות קלה עלולה לגרום לעייפות, לכאבי ראש ולירידה בריכוז.",
  },
  magnesium: {
    en: "Magnesium takes part in hundreds of processes in the body, including muscle and nerve function, energy production and bone health. Low intake can show up as muscle cramps, fatigue and poor sleep.",
    he: "מגנזיום משתתף במאות תהליכים בגוף, ביניהם פעילות השרירים והעצבים, ייצור אנרגיה ובריאות העצם. צריכה נמוכה עלולה להתבטא בהתכווצויות שרירים, בעייפות ובשינה פחות טובה.",
  },
  potassium: {
    en: "Potassium keeps the heart, muscles and nerves working properly and balances the body's fluids. It also helps offset sodium's effect on blood pressure.",
    he: "אשלגן שומר על פעילות תקינה של הלב, השרירים והעצבים ומאזן את הנוזלים בגוף. הוא גם עוזר לאזן את השפעת הנתרן על לחץ הדם.",
  },
  iron: {
    en: "Iron is needed to make hemoglobin, which carries oxygen in the blood to every part of the body. Too little can lead to anemia, with fatigue, weakness and reduced concentration.",
    he: "ברזל נחוץ לייצור המוגלובין, שמוביל חמצן בדם לכל חלקי הגוף. מחסור עלול להוביל לאנמיה, שמתבטאת בעייפות, בחולשה ובירידה בריכוז.",
  },
  zinc: {
    en: "Zinc supports the immune system, wound healing, and the senses of taste and smell. The body doesn't store it, so it needs a regular supply from food.",
    he: "אבץ תומך במערכת החיסון, בריפוי פצעים ובחושי הטעם והריח. הגוף לא אוגר אותו, ולכן צריך לקבל אותו באופן קבוע מהמזון.",
  },
  sodium: {
    en: "Sodium (mostly from salt) helps balance fluids and supports nerve and muscle function, but the body needs only a little. Too much raises blood pressure and the risk of heart disease and stroke; most of it comes from processed foods, snacks and ready-made sauces.",
    he: "נתרן (בעיקר ממלח) עוזר לאזן נוזלים ותומך בפעילות העצבים והשרירים, אבל הגוף צריך רק מעט ממנו. עודף מעלה את לחץ הדם ואת הסיכון למחלות לב ולשבץ; רובו מגיע ממזון מעובד, מחטיפים ומרטבים מוכנים.",
  },
  addedSugar: {
    en: "Added sugar is sugar or syrup added during processing or cooking - it provides calories with almost no nutrients. Too much is linked to weight gain, tooth decay, type 2 diabetes and heart disease, so it's best kept low.",
    he: "סוכר מוסף הוא סוכר או סירופ שהוסף בעיבוד או בהכנה - הוא מספק קלוריות כמעט בלי ערך תזונתי. עודף קשור לעלייה במשקל, לעששת, לסוכרת מסוג 2 ולמחלות לב, ולכן עדיף לצרוך מעט ממנו.",
  },
  calcium: {
    en: "Calcium builds and maintains strong bones and teeth, and is needed for muscle contraction, nerve signals and a regular heartbeat. Getting enough over the years helps protect against osteoporosis.",
    he: "סידן בונה ושומר על עצמות ושיניים חזקות, ונחוץ להתכווצות שרירים, להעברת אותות עצביים ולקצב לב תקין. צריכה מספקת לאורך השנים עוזרת להגן מפני אוסטאופורוזיס.",
  },
  vitC: {
    en: "Vitamin C is an antioxidant that supports the immune system, helps build collagen for skin and blood vessels, and improves iron absorption from plant foods. The body doesn't store it, so it's needed every day.",
    he: "ויטמין C הוא נוגד חמצון שתומך במערכת החיסון, עוזר לבנות קולגן לעור ולכלי הדם ומשפר את ספיגת הברזל ממזון צמחי. הגוף לא אוגר אותו, ולכן צריך אותו בכל יום.",
  },
  vitB12: {
    en: "Vitamin B12 is needed to make red blood cells and to keep the nervous system healthy. It comes mainly from animal foods, so vegetarians and vegans may need fortified foods or a supplement.",
    he: "ויטמין B12 נחוץ לייצור תאי דם אדומים ולשמירה על תקינות מערכת העצבים. הוא מגיע בעיקר ממזון מן החי, ולכן צמחונים וטבעונים עשויים להזדקק למזון מועשר או לתוסף.",
  },
  vitD: {
    en: "Vitamin D helps the body absorb calcium, keeping bones strong, and supports the immune system and muscles. Few foods contain much of it - the body makes most of it from sunlight on the skin.",
    he: "ויטמין D עוזר לגוף לספוג סידן ולשמור על עצמות חזקות, ותומך במערכת החיסון ובשרירים. מעט מזונות מכילים אותו בכמות משמעותית - את רובו הגוף מייצר מחשיפה של העור לשמש.",
  },
  satFat: {
    en: "Saturated fat is found mainly in fatty meat, butter, cream, cheese and coconut oil. Too much raises LDL ('bad') cholesterol and the risk of heart disease, so it's best limited and swapped for unsaturated fats where possible.",
    he: "שומן רווי נמצא בעיקר בבשר שמן, בחמאה, בשמנת, בגבינות ובשמן קוקוס. עודף מעלה את הכולסטרול ה'רע' (LDL) ואת הסיכון למחלות לב, ולכן עדיף להגביל אותו ולהחליף אותו בשומנים בלתי רוויים כשאפשר.",
  },
  omega3: {
    en: "Omega-3 fatty acids support heart, brain and eye health and help reduce inflammation. The body can't make enough of them on its own - good sources are oily fish, walnuts, flax and chia seeds.",
    he: "חומצות שומן אומגה 3 תומכות בבריאות הלב, המוח והעיניים ועוזרות להפחית דלקת. הגוף לא מייצר מהן מספיק בעצמו - מקורות טובים הם דגים שמנים, אגוזי מלך, זרעי פשתן וצ'יה.",
  },
  cholesterol: {
    en: "Cholesterol is needed to build cells and hormones, and the liver makes all the body needs. Dietary cholesterol (from eggs, meat, organ meats and full-fat dairy) can raise blood cholesterol in some people, which is why it's worth keeping in check.",
    he: "כולסטרול נחוץ לבניית תאים והורמונים, והכבד מייצר את כל מה שהגוף צריך. כולסטרול מהמזון (ביצים, בשר, איברים פנימיים ומוצרי חלב שמנים) עלול להעלות את רמת הכולסטרול בדם אצל חלק מהאנשים, ולכן כדאי לשים לב לכמות.",
  },
};

export function getMetricExplanation(metricId: string, locale: AppLocale): string | null {
  if (!isDailyReportChartMetric(metricId)) return null;
  const explanation = METRIC_EXPLANATIONS[metricId];
  return tr(locale, explanation.en, explanation.he);
}

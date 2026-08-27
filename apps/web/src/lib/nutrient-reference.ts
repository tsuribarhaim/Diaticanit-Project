// Static, bilingual nutrient reference used by the Targets dashboard's info
// popovers. This is a plain bundled module (no DB round-trip, no client
// cache needed) — Next.js already inlines it into the page bundle.

export type NutrientLayer = "primary" | "secondary";

export type NutrientReferenceEntry = {
  id: string;
  layer: NutrientLayer;
  unit: string;
  nameLabel: { en: string; he: string };
  roleDescription: { en: string; he: string };
  foodExamples: { en: string; he: string };
};

export const nutrientReference: NutrientReferenceEntry[] = [
  {
    id: "calories",
    layer: "primary",
    unit: "kcal",
    nameLabel: { en: "Calories", he: "קלוריות" },
    roleDescription: {
      en: "Total daily energy intake. Drives weight loss, gain, or maintenance depending on the balance against what you burn.",
      he: "סך צריכת האנרגיה היומית. קובעת ירידה, עלייה או שמירה על משקל בהתאם לאיזון מול הקלוריות שנשרפות.",
    },
    foodExamples: {
      en: "Whole meals: a balanced plate with protein, grains, and vegetables.",
      he: "ארוחות שלמות: צלחת מאוזנת עם חלבון, דגנים וירקות.",
    },
  },
  {
    id: "protein",
    layer: "primary",
    unit: "g",
    nameLabel: { en: "Protein", he: "חלבון" },
    roleDescription: {
      en: "Supports muscle repair and growth, satiety, and immune function.",
      he: "תומך בשיקום ובניית שריר, בתחושת שובע ובתפקוד מערכת החיסון.",
    },
    foodExamples: {
      en: "Chicken breast, eggs, fish, tofu, lentils, Greek yogurt.",
      he: "חזה עוף, ביצים, דגים, טופו, עדשים, יוגורט יווני.",
    },
  },
  {
    id: "carbs",
    layer: "primary",
    unit: "g",
    nameLabel: { en: "Carbohydrates", he: "פחמימות" },
    roleDescription: {
      en: "Primary fuel source for the brain and physical activity.",
      he: "מקור האנרגיה העיקרי למוח ולפעילות גופנית.",
    },
    foodExamples: {
      en: "Rice, oats, whole-grain bread, potatoes, fruit.",
      he: "אורז, שיבולת שועל, לחם מלא, תפוחי אדמה, פירות.",
    },
  },
  {
    id: "fats",
    layer: "primary",
    unit: "g",
    nameLabel: { en: "Fats", he: "שומנים" },
    roleDescription: {
      en: "Supports hormone production, vitamin absorption, and long-lasting energy.",
      he: "תומך בייצור הורמונים, בספיגת ויטמינים ובאנרגיה לטווח ארוך.",
    },
    foodExamples: {
      en: "Olive oil, avocado, nuts, seeds, fatty fish.",
      he: "שמן זית, אבוקדו, אגוזים, זרעים, דגים שמנים.",
    },
  },
  {
    id: "fiber",
    layer: "primary",
    unit: "g",
    nameLabel: { en: "Dietary Fiber", he: "סיבים תזונתיים" },
    roleDescription: {
      en: "Supports digestion, gut health, and steady blood sugar levels.",
      he: "תומך בעיכול, בבריאות מערכת העיכול ובאיזון רמות הסוכר בדם.",
    },
    foodExamples: {
      en: "Vegetables, legumes, whole grains, berries, chia seeds.",
      he: "ירקות, קטניות, דגנים מלאים, פירות יער, זרעי צ'יה.",
    },
  },
  {
    id: "sodium",
    layer: "primary",
    unit: "mg",
    nameLabel: { en: "Sodium", he: "נתרן" },
    roleDescription: {
      en: "Needed in small amounts for fluid balance; excess intake is linked to elevated blood pressure.",
      he: "נדרש בכמות קטנה לאיזון נוזלים; צריכה עודפת קשורה לעלייה בלחץ הדם.",
    },
    foodExamples: {
      en: "Table salt, processed/cured meats, canned soups, salty snacks.",
      he: "מלח שולחן, בשרים מעובדים, מרקים משומרים, חטיפים מלוחים.",
    },
  },
  {
    id: "added_sugar",
    layer: "primary",
    unit: "g",
    nameLabel: { en: "Added Sugars", he: "סוכרים מוספים" },
    roleDescription: {
      en: "Sugars added during processing or preparation; keeping this low supports metabolic health.",
      he: "סוכרים שנוספים בתהליך העיבוד או ההכנה; שמירה על כמות נמוכה תומכת בבריאות המטבולית.",
    },
    foodExamples: {
      en: "Soft drinks, candy, pastries, sweetened coffee drinks.",
      he: "משקאות ממותקים, ממתקים, מאפים, משקאות קפה ממותקים.",
    },
  },
  {
    id: "water",
    layer: "primary",
    unit: "ml",
    nameLabel: { en: "Fluid / Water", he: "נוזלים / מים" },
    roleDescription: {
      en: "Supports temperature regulation, joint lubrication, and nutrient transport.",
      he: "תומך בוויסות חום הגוף, בשימון המפרקים ובהובלת חומרי מזון.",
    },
    foodExamples: {
      en: "Water, herbal tea, water-rich fruits and vegetables.",
      he: "מים, תה צמחים, פירות וירקות עתירי מים.",
    },
  },
  {
    id: "potassium",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Potassium", he: "אשלגן" },
    roleDescription: {
      en: "Helps regulate fluid balance, muscle contractions, and heart rhythm.",
      he: "מסייע לאיזון נוזלים, לכיווץ שרירים ולקצב הלב.",
    },
    foodExamples: {
      en: "Bananas, potatoes, spinach, beans, avocado.",
      he: "בננות, תפוחי אדמה, תרד, שעועית, אבוקדו.",
    },
  },
  {
    id: "magnesium",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Magnesium", he: "מגנזיום" },
    roleDescription: {
      en: "Involved in muscle and nerve function, blood sugar control, and bone health.",
      he: "מעורב בתפקוד שרירים ועצבים, באיזון סוכר בדם ובבריאות העצם.",
    },
    foodExamples: {
      en: "Almonds, spinach, whole grains, dark chocolate.",
      he: "שקדים, תרד, דגנים מלאים, שוקולד מריר.",
    },
  },
  {
    id: "calcium",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Calcium", he: "סידן" },
    roleDescription: {
      en: "Essential for bone and teeth strength, and supports muscle and nerve signaling.",
      he: "חיוני לחוזק העצמות והשיניים, ותומך בתפקוד השרירים והעצבים.",
    },
    foodExamples: {
      en: "Dairy products, fortified plant milk, sardines, leafy greens.",
      he: "מוצרי חלב, חלב צמחי מועשר, סרדינים, ירקות עליים.",
    },
  },
  {
    id: "iron",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Iron", he: "ברזל" },
    roleDescription: {
      en: "Needed to carry oxygen in the blood; low intake can lead to fatigue and anemia.",
      he: "נדרש להובלת חמצן בדם; צריכה נמוכה עלולה לגרום לעייפות ואנמיה.",
    },
    foodExamples: {
      en: "Red meat, lentils, spinach, fortified cereals.",
      he: "בשר אדום, עדשים, תרד, דגני בוקר מועשרים.",
    },
  },
  {
    id: "zinc",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Zinc", he: "אבץ" },
    roleDescription: {
      en: "Supports immune function, wound healing, and metabolism.",
      he: "תומך בתפקוד מערכת החיסון, בריפוי פצעים ובחילוף החומרים.",
    },
    foodExamples: {
      en: "Meat, shellfish, pumpkin seeds, chickpeas.",
      he: "בשר, פירות ים, גרעיני דלעת, חומוס.",
    },
  },
  {
    id: "vit_c",
    layer: "secondary",
    unit: "mg",
    nameLabel: { en: "Vitamin C", he: "ויטמין C" },
    roleDescription: {
      en: "Antioxidant that supports immune function and collagen production.",
      he: "נוגד חמצון התומך בתפקוד מערכת החיסון ובייצור קולגן.",
    },
    foodExamples: {
      en: "Citrus fruits, bell peppers, strawberries, broccoli.",
      he: "פירות הדר, פלפלים, תותים, ברוקולי.",
    },
  },
  {
    id: "vit_b12",
    layer: "secondary",
    unit: "mcg",
    nameLabel: { en: "Vitamin B12", he: "ויטמין B12" },
    roleDescription: {
      en: "Supports nerve function and red blood cell formation.",
      he: "תומך בתפקוד מערכת העצבים וביצירת תאי דם אדומים.",
    },
    foodExamples: {
      en: "Meat, fish, eggs, dairy, fortified nutritional yeast.",
      he: "בשר, דגים, ביצים, מוצרי חלב, שמרים תזונתיים מועשרים.",
    },
  },
  {
    id: "vit_d",
    layer: "secondary",
    unit: "mcg",
    nameLabel: { en: "Vitamin D", he: "ויטמין D" },
    roleDescription: {
      en: "Supports calcium absorption, bone health, and immune function.",
      he: "תומך בספיגת סידן, בבריאות העצם ובתפקוד מערכת החיסון.",
    },
    foodExamples: {
      en: "Fatty fish, egg yolks, fortified milk, sunlight exposure.",
      he: "דגים שמנים, חלמון ביצה, חלב מועשר, חשיפה לשמש.",
    },
  },
  {
    id: "sat_fat",
    layer: "secondary",
    unit: "g",
    nameLabel: { en: "Saturated Fat", he: "שומן רווי" },
    roleDescription: {
      en: "Keeping this low supports cardiovascular health; unlike unsaturated fats, it should be limited.",
      he: "שמירה על כמות נמוכה תומכת בבריאות הלב וכלי הדם; בניגוד לשומנים בלתי רוויים, יש להגבילו.",
    },
    foodExamples: {
      en: "Butter, fatty cuts of red meat, full-fat cheese, coconut oil.",
      he: "חמאה, נתחי בשר אדום שמנים, גבינה שמנה, שמן קוקוס.",
    },
  },
  {
    id: "omega3",
    layer: "secondary",
    unit: "g",
    nameLabel: { en: "Omega-3", he: "אומגה 3" },
    roleDescription: {
      en: "Supports heart and brain health, and helps reduce inflammation.",
      he: "תומך בבריאות הלב והמוח, ומסייע בהפחתת דלקתיות.",
    },
    foodExamples: {
      en: "Salmon, sardines, walnuts, flaxseed, chia seeds.",
      he: "סלמון, סרדינים, אגוזי מלך, זרעי פשתן, זרעי צ'יה.",
    },
  },
];

export function getNutrientReference(id: string): NutrientReferenceEntry | undefined {
  return nutrientReference.find((entry) => entry.id === id);
}

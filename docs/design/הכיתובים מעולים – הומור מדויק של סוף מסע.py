
```python
import os
import glob
from PIL import Image, ImageDraw, ImageFont

def wrap_hebrew_text(text, font, max_width, draw):
    """פירוק טקסט ארוך לשורות שמתאימות לרוחב הקנבס כולל טיפול בסידור עברית"""
    paragraphs = text.split('\n')
    wrapped_lines = []
    
    for paragraph in paragraphs:
        words = paragraph.split(' ')
        current_line = []
        
        for word in words:
            test_line = ' '.join(current_line + [word])
            # חישוב רוחב הטקסט
            bbox = draw.textbbox((0, 0), test_line, font=font)
            if bbox[2] - bbox[0] <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    wrapped_lines.append(' '.join(current_line))
                current_line = [word]
        if current_line:
            wrapped_lines.append(' '.join(current_line))
            
    return wrapped_lines

def create_photo_portrait(folder_path, main_title, body_text, output_filename, max_images=9):
    extensions = ('*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG')
    image_paths = []
    for ext in extensions:
        image_paths.extend(glob.glob(os.path.join(folder_path, ext)))
    
    if not image_paths:
        print(f"לא נמצאו תמונות בתיקייה: {folder_path}")
        return

    image_paths = image_paths[:max_images]
    
    # מידות קנבס
    canvas_width = 1200
    header_height = 140
    footer_height = 280  # מוקצה לטקסט ההקדשה בתחתית
    grid_padding = 15
    
    cols = 3
    rows = (len(image_paths) + cols - 1) // cols
    
    cell_width = (canvas_width - grid_padding * (cols + 1)) // cols
    cell_height = cell_width
    
    grid_height = (rows * cell_height) + ((rows + 1) * grid_padding)
    canvas_height = header_height + grid_height + footer_height
    
    canvas = Image.new('RGB', (canvas_width, canvas_height), color=(255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    
    # גופנים
    try:
        title_font = ImageFont.truetype("arial.ttf", 44)
        body_font = ImageFont.truetype("arial.ttf", 24)
    except:
        title_font = ImageFont.load_default()
        body_font = ImageFont.load_default()

    # 1. כותרת ראשית (עליונה)
    draw.text((canvas_width // 2, 70), main_title[::-1], fill=(20, 20, 20), font=title_font, anchor="mm")
    
    # 2. שיבוץ התמונות בגריד
    for index, img_path in enumerate(image_paths):
        r = index // cols
        c = index % cols
        
        x = grid_padding + c * (cell_width + grid_padding)
        y = header_height + grid_padding + r * (cell_height + grid_padding)
        
        try:
            with Image.open(img_path) as img:
                aspect = img.width / img.height
                if aspect > 1:
                    new_h = cell_height
                    new_w = int(aspect * new_h)
                else:
                    new_w = cell_width
                    new_h = int(new_w / aspect)
                
                img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                left = (new_w - cell_width) // 2
                top = (new_h - cell_height) // 2
                img_cropped = img_resized.crop((left, top, left + cell_width, top + cell_height))
                
                canvas.paste(img_cropped, (x, y))
        except Exception as e:
            print(f"שגיאה בטעינת תמונה {img_path}: {e}")

    # 3. כיתוב מוקדש בתחתית
    lines = wrap_hebrew_text(body_text, body_font, canvas_width - 100, draw)
    
    footer_start_y = header_height + grid_height + 30
    line_spacing = 34
    
    for i, line in enumerate(lines):
        # היפוך מחרוזת לתמיכה בעברית ב-Pillow
        reversed_line = line[::-1]
        draw.text((canvas_width // 2, footer_start_y + (i * line_spacing)), 
                  reversed_line, fill=(40, 40, 40), font=body_font, anchor="mm")

    # שמירה
    output_path = os.path.join(folder_path, output_filename)
    canvas.save(output_path, quality=95)
    print(f"הפורטרייט נוצר בהצלחה: {output_path}")

# --- הרצה ---
folder = r"C:\Private\Travel\Motorcycle\Portugal 2026"
main_title = "פורטוגל 09/26 אופנועים"

text_1 = """שחר בר-חיים המתמיד היקר, מקסימום נידנודים למדריך, מינימום מהירות נסיעה. נראה שהיית במיטבך כבר מהטיול הראשון ואותה הרמה נשמרה גם הפעם. אין חדש תחת השמש.
בהצלחה במעבר להנדי-גיא טיולים, ובהצלחה להנדי-גיא איתך!!!
עלה והצלח!"""

text_2 = """גיא בר-חיים ומותגים היקר, הוכחת שטיול אופנועים עד 10 ימים מצריך יחידה אחת בלבד מכול פריט לבוש. בכסף שחסכת קנית את חברת הטיולים, ושנה הבאה אתה אחראי על ההוא. כיבסת יותר משרכבת ועל זה קיבלת השנה את אות "הכובס המצטיין" לשנת 2026!
עלה והצלח!"""

# יצירת שני הקבצים
create_photo_portrait(folder, main_title, text_1, "Portugal_Portrait_Shahar.jpg")
create_photo_portrait(folder, main_title, text_2, "Portugal_Portrait_Guy.jpg")

```


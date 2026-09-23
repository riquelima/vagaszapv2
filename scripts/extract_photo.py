import sys
import json
import base64
from pypdf import PdfReader

def extract_photo(pdf_path):
    try:
        reader = PdfReader(pdf_path)
        for page in reader.pages:
            for img in page.images:
                # Fotos de perfil em currículos costumam ter mais de 8KB
                if len(img.data) > 8000:
                    b64 = base64.b64encode(img.data).decode('utf-8')
                    ext = 'png' if img.name.lower().endswith('.png') else 'jpeg'
                    return f"data:image/{ext};base64,{b64}"
    except Exception as e:
        pass
    return None

if __name__ == '__main__':
    if len(sys.argv) > 1:
        photo = extract_photo(sys.argv[1])
        print(json.dumps({"photo_url": photo}))
    else:
        print(json.dumps({"photo_url": None}))

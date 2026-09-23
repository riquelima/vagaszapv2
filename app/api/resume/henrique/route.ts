import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'henrique_profile_en.json');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'Perfil não encontrado.' }, { status: 404 });
    }

    const profileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return NextResponse.json({
      success: true,
      profile: profileData,
      fileName: 'Henrique_Lima_Resume_EN.pdf',
      fileSize: '1.4 MB'
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

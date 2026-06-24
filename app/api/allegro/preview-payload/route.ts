import { NextRequest, NextResponse } from 'next/server';
import { buildAllegroPayload } from '@/lib/allegro';

export async function POST(req: NextRequest) {
  try {
    const { formData } = await req.json();
    if (!formData) {
      return NextResponse.json({ error: 'formData is required' }, { status: 400 });
    }
    const payload = await buildAllegroPayload(formData);
    return NextResponse.json({ payload });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to build payload', details: String(error) },
      { status: 500 }
    );
  }
}

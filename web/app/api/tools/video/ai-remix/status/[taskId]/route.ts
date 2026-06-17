import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  
  try {
    const response = await fetch(`${BACKEND_URL}/tools/video/ai-remix/status/${taskId}`, {
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend returned ${response.status}` }, 
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Error polling task ${taskId}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) }, 
      { status: 500 }
    );
  }
}

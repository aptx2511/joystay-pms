import { NextResponse } from "next/server";
// Full implementation comes in Step 4 (iCal export)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  return NextResponse.json({
    message: `iCal export for room ${roomId} will be implemented in Step 4.`,
  });
}

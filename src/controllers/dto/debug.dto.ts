import { ApiProperty } from "@nestjs/swagger";

export class HeapDumpResponseDto {
  @ApiProperty({
    description: "The path to the generated heap dump file.",
    example: "/logs/heap-1678886400000.heapsnapshot",
    required: false,
  })
  path?: string;

  @ApiProperty({
    description: "An error message if the heap dump could not be created.",
    example: "Failed to write heap snapshot: ...",
    required: false,
  })
  error?: string;
}

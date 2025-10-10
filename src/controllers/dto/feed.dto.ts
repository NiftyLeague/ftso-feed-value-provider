import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsNumber, IsString, ValidateNested, ArrayMinSize, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";

export class FeedErrorDto {
  @ApiProperty({
    description: "Error code",
    example: "FEED_NOT_FOUND",
  })
  code!: string;

  @ApiProperty({
    description: "Error message",
    example: "Unable to retrieve data for feed",
  })
  message!: string;

  @ApiProperty({
    description: "Error timestamp",
    example: 1703123456789,
  })
  timestamp!: number;
}

export class FeedIdDto {
  @ApiProperty({
    description: "Feed category (1=Crypto, 2=Forex, 3=Commodity, 4=Stock)",
    example: 1,
    minimum: 1,
    maximum: 4,
  })
  @IsNumber()
  category!: number;

  @ApiProperty({
    description: "Feed name identifier",
    example: "BTC/USD",
    minLength: 1,
  })
  @IsString()
  name!: string;
}

export class FeedValuesRequestDto {
  @ApiProperty({
    description: "Array of feed identifiers to retrieve values for",
    type: [FeedIdDto],
    minItems: 1,
    maxItems: 50,
    example: [
      { category: 1, name: "BTC/USD" },
      { category: 1, name: "ETH/USD" },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeedIdDto)
  feeds!: FeedIdDto[];
}

export class FeedValueDataDto {
  @ApiProperty({
    description: "Feed identifier",
    type: FeedIdDto,
  })
  feed!: FeedIdDto;

  @ApiProperty({
    description: "Feed value in base units as float",
    example: 45000.25,
  })
  value!: number;

  @ApiProperty({
    description: "Data source identifier",
    example: "cache",
    enum: ["cache", "aggregated", "fallback", "fallback_error"],
    required: false,
  })
  source?: string;

  @ApiProperty({
    description: "Timestamp when the value was retrieved",
    example: 1703123456789,
    required: false,
  })
  timestamp?: number;

  @ApiProperty({
    description: "Confidence score for the data (0.0 to 1.0)",
    example: 0.95,
    minimum: 0,
    maximum: 1,
    required: false,
  })
  confidence?: number;

  @ApiProperty({
    description: "Error information if feed data retrieval failed",
    required: false,
    type: FeedErrorDto,
  })
  error?: FeedErrorDto;
}

export class FeedValuesResponseDto {
  @ApiProperty({
    description: "Array of feed value data",
    type: [FeedValueDataDto],
  })
  data!: FeedValueDataDto[];
}

export class RoundFeedValuesResponseDto {
  @ApiProperty({
    description: "Voting round identifier",
    example: 12345,
  })
  votingRoundId!: number;

  @ApiProperty({
    description: "Array of feed value data for the specified voting round",
    type: [FeedValueDataDto],
  })
  data!: FeedValueDataDto[];
}

export class VolumeDto {
  @ApiProperty({
    description: "Exchange name",
    example: "binance",
  })
  exchange!: string;

  @ApiProperty({
    description: "Volume amount",
    example: 1500000.5,
  })
  volume!: number;
}

export class FeedVolumeDataDto {
  @ApiProperty({
    description: "Feed identifier",
    type: FeedIdDto,
  })
  feed!: FeedIdDto;

  @ApiProperty({
    description: "Array of volume data from different exchanges",
    type: [VolumeDto],
  })
  volumes!: VolumeDto[];
}

export class VolumesRequestDto {
  @ApiProperty({
    description: "Array of feed identifiers to retrieve volumes for",
    type: [FeedIdDto],
    minItems: 1,
    maxItems: 50,
    example: [
      { category: 1, name: "BTC/USD" },
      { category: 1, name: "ETH/USD" },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeedIdDto)
  feeds!: FeedIdDto[];

  @ApiProperty({
    description: "Start time for volume calculation (optional)",
    example: 1703123456789,
    required: false,
  })
  @IsNumber()
  startTime?: number;
}

export class FeedVolumesResponseDto {
  @ApiProperty({
    description: "Array of feed volume data",
    type: [FeedVolumeDataDto],
  })
  data!: FeedVolumeDataDto[];

  @ApiProperty({
    description: "Time window in seconds for volume calculation",
    example: 60,
  })
  windowSec!: number;
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);


// =========================================================
// ⛏️ BLACK MINE
// Discord Mining Module
// =========================================================


function getTokensFromUser(user) {
    return user ? Math.floor(user.tokens ?? 200) : 200;
}


async function getAttendanceUser(userId) {
    const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}


async function getMiningPlayer(userId) {

    const { data, error } = await supabase
        .from('mining_players')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: created, error: createError } = await supabase
        .from('mining_players')
        .insert({
            user_id: userId
        })
        .select('*')
        .single();

    if (createError) {
        throw createError;
    }

    return created;
}


async function getMiningUpgrade(userId) {

    const { data, error } = await supabase
        .from('mining_upgrades')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: created, error: createError } = await supabase
        .from('mining_upgrades')
        .insert({
            user_id: userId
        })
        .select('*')
        .single();

    if (createError) {
        throw createError;
    }

    return created;
}


// =========================================================
// ⏱️ 에너지 표시 계산
// =========================================================

function calculateCurrentEnergy(player) {

    let energy = player.energy ?? 0;

    if (!player.last_mine_at) {
        return Math.min(
            player.max_energy ?? 10,
            energy
        );
    }

    const lastMine = new Date(player.last_mine_at);
    const now = new Date();

    const minutes =
        Math.floor(
            (now.getTime() - lastMine.getTime())
            / 60000
        );

    if (minutes < 30) {
        return energy;
    }

    const regenerated =
        Math.floor(minutes / 30);

    return Math.min(
        player.max_energy ?? 10,
        energy + regenerated
    );
}


// =========================================================
// 📊 에너지 바
// =========================================================

function makeBar(current, max, size = 10) {

    if (!max || max <= 0) {
        return '░'.repeat(size);
    }

    const ratio = Math.max(
        0,
        Math.min(1, current / max)
    );

    const filled = Math.round(
        ratio * size
    );

    return (
        '█'.repeat(filled) +
        '░'.repeat(size - filled)
    );
}


// =========================================================
// ⛏️ !광산
// =========================================================

async function showMine(message) {

    const userId = message.author.id;

    const [player, upgrade, attendance] =
        await Promise.all([
            getMiningPlayer(userId),
            getMiningUpgrade(userId),
            getAttendanceUser(userId)
        ]);

    const energy =
        calculateCurrentEnergy(player);

    const tokens =
        getTokensFromUser(attendance);

    const nextLevelXp =
        player.level * 100;

    const currentXp =
        player.xp ?? 0;

    const xpProgress =
        Math.min(
            100,
            Math.floor(
                (currentXp / nextLevelXp) * 100
            )
        );

    const durability =
        player.pickaxe_durability ?? 0;

    const maxDurability =
        player.max_pickaxe_durability ?? 20;

    return message.reply(
        `⛏️ **BLACK MINE** ⛏️\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📍 **현재 깊이:** \`${player.depth}m\`\n` +
        `⭐ **광부 레벨:** \`${player.level}\`\n` +
        `✨ **경험치:** \`${currentXp} / ${nextLevelXp}\` (${xpProgress}%)\n\n` +

        `⚡ **에너지:** \`${energy}/${player.max_energy}\`\n` +
        `${makeBar(energy, player.max_energy)}\n\n` +

        `⛏️ **곡괭이 Lv.${player.pickaxe_level}**\n` +
        `${makeBar(durability, maxDurability)} ` +
        `\`${durability}/${maxDurability}\`\n\n` +

        `🍀 **행운 강화:** Lv.${upgrade.luck_level}\n` +
        `📦 **채굴량 강화:** Lv.${upgrade.yield_level}\n` +
        `⚡ **속도 강화:** Lv.${upgrade.speed_level}\n\n` +

        `💰 **보유 토큰:** \`${tokens}\`\n` +

        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⛏️ \`!채굴\` — 광물 채굴\n` +
        `🎒 \`!광물\` — 인벤토리\n` +
        `💰 \`!광물판매\` — 광물 판매\n` +
        `🔧 \`!수리\` — 곡괭이 수리\n` +
        `⬆️ \`!강화\` — 장비 강화\n` +
        `🏆 \`!광산랭킹\` — 광산 랭킹`
    );
}


// =========================================================
// ⛏️ !채굴
// =========================================================

async function mine(message) {

    const userId = message.author.id;

    const { data, error } =
        await supabase.rpc(
            'mining_mine',
            {
                p_user_id: userId
            }
        );

    if (error) {
        console.error(
            '❌ mining_mine RPC error:',
            error
        );

        return message.reply(
            '❌ **채굴 시스템 오류가 발생했습니다.**'
        );
    }

    if (!data || !data.success) {

        if (data?.reason === 'NO_ENERGY') {

            return message.reply(
                `⚡ **에너지가 부족합니다!**\n` +
                `현재 에너지: \`${data.energy}/${data.max_energy}\`\n` +
                `⏱️ 에너지는 **30분마다 1** 회복됩니다.`
            );

        }

        if (data?.reason === 'BROKEN_PICKAXE') {

            return message.reply(
                `💥 **곡괭이가 부러졌습니다!**\n` +
                `⛏️ 내구도: \`0/${data.max_durability}\`\n\n` +
                `🔧 \`!수리\` 명령어로 수리하세요.`
            );

        }

        return message.reply(
            '❌ **채굴할 수 없습니다.**'
        );
    }


    let extraText = '';

    if (data.old_level < data.new_level) {

        extraText +=
            `\n🎉 **LEVEL UP!**\n` +
            `⭐ 광부 레벨이 **${data.old_level} → ${data.new_level}**이 되었습니다!\n` +
            `📍 최대 채굴 깊이가 **${data.new_depth}m**로 증가했습니다!`;
    }

    if (data.old_depth < data.new_depth) {

        extraText +=
            `\n🗺️ **새로운 광맥 발견!**\n` +
            `깊이 **${data.new_depth}m**까지 탐사할 수 있습니다!`;
    }

    let rarityText = '';

    switch (data.rarity) {

        case 'COMMON':
            rarityText = '⚪ 일반';
            break;

        case 'UNCOMMON':
            rarityText = '🟢 고급';
            break;

        case 'RARE':
            rarityText = '🔵 희귀';
            break;

        case 'EPIC':
            rarityText = '🟣 영웅';
            break;

        case 'LEGENDARY':
            rarityText = '🟡 전설';
            break;

        case 'MYTHIC':
            rarityText = '🔴 신화';
            break;

        case 'CURSED':
            rarityText = '☠️ 저주';
            break;

        default:
            rarityText = data.rarity;
    }


    if (data.rarity === 'CURSED') {

        extraText +=
            `\n☠️ **주의:** 저주받은 광석은 판매 시 토큰을 잃습니다.`;
    }


    return message.reply(
        `⛏️ **채굴 완료!**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📍 채굴 위치: **${data.old_depth}m**\n\n` +

        `${data.emoji} **${data.ore_name}** × **${data.amount}**\n` +
        `희귀도: ${rarityText}\n\n` +

        `✨ **+${data.xp_earned} XP**\n` +
        `⚡ 에너지: \`${data.energy}/${data.max_energy}\`\n` +
        `⛏️ 내구도: \`${data.durability}/${data.max_durability}\`` +
        extraText
    );
}


// =========================================================
// 🎒 !광물
// =========================================================

async function showInventory(message) {

    const userId = message.author.id;

    const { data, error } =
        await supabase
            .from('mining_inventory')
            .select(`
                ore_id,
                amount,
                mining_ores (
                    name,
                    emoji,
                    sell_price,
                    rarity
                )
            `)
            .eq('user_id', userId)
            .gt('amount', 0)
            .order('amount', {
                ascending: false
            });

    if (error) {

        console.error(
            '❌ inventory error:',
            error
        );

        return message.reply(
            '❌ 인벤토리를 불러오지 못했습니다.'
        );
    }


    if (!data || data.length === 0) {

        return message.reply(
            `🎒 **광물 인벤토리**\n\n` +
            `현재 보유한 광물이 없습니다.\n\n` +
            `⛏️ \`!채굴\`을 사용해서 광물을 캐보세요!`
        );
    }


    let totalValue = 0;

    const lines = data.map(item => {

        const ore = item.mining_ores;

        const amount =
            Number(item.amount);

        const price =
            Number(ore.sell_price);

        const value =
            amount * price;

        totalValue += value;

        return (
            `${ore.emoji} **${ore.name}** ` +
            `× \`${amount}\`` +
            ` — ${value >= 0 ? '+' : ''}${value} 토큰`
        );
    });


    return message.reply(
        `🎒 **광물 인벤토리**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 **전체 판매 가치:** \`${totalValue}\` 토큰`
    );
}


// =========================================================
// 💰 !광물판매
//
// 사용:
// !광물판매 diamond 1
// !광물판매 all
// !광물판매 stone all
// =========================================================

async function sell(message, args) {

    const userId = message.author.id;

    if (args.length < 1) {

        return message.reply(
            `💰 **광물 판매 방법**\n\n` +
            `\`!광물판매 diamond 1\`\n` +
            `→ 다이아 1개 판매\n\n` +
            `\`!광물판매 diamond all\`\n` +
            `→ 보유한 다이아 전부 판매\n\n` +
            `광물 ID는 \`!광물목록\`에서 확인하세요.`
        );
    }


    const oreId =
        args[0].toLowerCase();

    let amount;

    if (
        args[1] &&
        args[1].toLowerCase() === 'all'
    ) {

        const { data: inventory } =
            await supabase
                .from('mining_inventory')
                .select('amount')
                .eq('user_id', userId)
                .eq('ore_id', oreId)
                .maybeSingle();

        if (!inventory) {

            return message.reply(
                '❌ 해당 광물을 가지고 있지 않습니다.'
            );
        }

        amount =
            Number(inventory.amount);

    } else {

        amount =
            Number(args[1]);
    }


    if (
        !Number.isInteger(amount) ||
        amount <= 0
    ) {

        return message.reply(
            '❌ 판매 수량은 올바른 정수여야 합니다.'
        );
    }


    const { data, error } =
        await supabase.rpc(
            'mining_sell_ore',
            {
                p_user_id: userId,
                p_ore_id: oreId,
                p_amount: amount
            }
        );


    if (error) {

        console.error(
            '❌ sell RPC error:',
            error
        );

        return message.reply(
            '❌ **광물 판매 처리 중 오류가 발생했습니다.**'
        );
    }


    if (!data || !data.success) {

        if (
            data?.reason ===
            'NOT_ENOUGH_ORE'
        ) {

            return message.reply(
                `❌ 광물이 부족합니다.\n` +
                `보유량: \`${data.owned ?? 0}\``
            );
        }


        if (
            data?.reason ===
            'ORE_NOT_FOUND'
        ) {

            return message.reply(
                `❌ 존재하지 않는 광물입니다.\n` +
                `\`!광물목록\`에서 광물 ID를 확인하세요.`
            );
        }


        return message.reply(
            '❌ 판매할 수 없습니다.'
        );
    }


    const sign =
        data.total_price >= 0
            ? '+'
            : '';


    return message.reply(
        `💰 **광물 판매 완료!**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${data.emoji} **${data.ore_name}** × \`${data.amount}\`\n` +
        `단가: \`${data.unit_price}\` 토큰\n\n` +
        `💵 정산: **${sign}${data.total_price} 토큰**\n` +
        `🎒 남은 수량: \`${data.remaining}\`\n` +
        `💳 현재 토큰: **${data.new_tokens}**`
    );
}


// =========================================================
// 📚 !광물목록
// =========================================================

async function showOreList(message) {

    const { data, error } =
        await supabase
            .from('mining_ores')
            .select('*')
            .order('min_depth', {
                ascending: true
            });


    if (error) {

        console.error(
            '❌ ore list error:',
            error
        );

        return message.reply(
            '❌ 광물 목록을 불러오지 못했습니다.'
        );
    }


    const lines =
        data.map(ore => {

            const price =
                ore.sell_price;

            const priceText =
                price < 0
                    ? `⚠️ ${price}`
                    : `💰 ${price}`;

            return (
                `${ore.emoji} **${ore.name}** ` +
                `\`${ore.ore_id}\`\n` +
                `└ 깊이 ${ore.min_depth}m · ${ore.rarity} · ${priceText} 토큰`
            );
        });


    return message.reply(
        `⛏️ **광물 도감**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join('\n')
    );
}


// =========================================================
// 🔧 !수리
// =========================================================

async function repair(message) {

    const userId = message.author.id;

    const { data, error } =
        await supabase.rpc(
            'mining_repair_pickaxe',
            {
                p_user_id: userId
            }
        );


    if (error) {

        console.error(
            '❌ repair RPC error:',
            error
        );

        return message.reply(
            '❌ 수리 처리 중 오류가 발생했습니다.'
        );
    }


    if (!data || !data.success) {

        if (
            data?.reason ===
            'FULL_DURABILITY'
        ) {

            return message.reply(
                '⛏️ 곡괭이는 이미 최대 내구도입니다!'
            );
        }


        if (
            data?.reason ===
            'NO_TOKEN'
        ) {

            return message.reply(
                `💰 토큰이 부족합니다.\n` +
                `필요: \`${data.cost}\`\n` +
                `보유: \`${data.tokens}\``
            );
        }


        return message.reply(
            '❌ 곡괭이를 수리할 수 없습니다.'
        );
    }


    return message.reply(
        `🔧 **곡괭이 수리 완료!**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 수리 비용: \`${data.cost}\` 토큰\n` +
        `⛏️ 내구도: **${data.durability}/${data.durability}**\n` +
        `💰 남은 토큰: \`${data.tokens}\``
    );
}


// =========================================================
// ⬆️ !강화
//
// !강화 곡괭이
// !강화 행운
// !강화 채굴량
// =========================================================

async function upgrade(message, args) {

    const type =
        (args[0] || '').toLowerCase();


    const typeMap = {

        '곡괭이': 'pickaxe',
        'pickaxe': 'pickaxe',

        '행운': 'luck',
        'luck': 'luck',

        '채굴량': 'yield',
        'yield': 'yield'
    };


    if (!typeMap[type]) {

        return message.reply(
            `⬆️ **강화 목록**\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⛏️ \`!강화 곡괭이\`\n` +
            `→ 곡괭이 레벨 +1\n\n` +
            `🍀 \`!강화 행운\`\n` +
            `→ 희귀 광물 확률 증가\n\n` +
            `📦 \`!강화 채굴량\`\n` +
            `→ 추가 광물 획득 확률 증가`
        );
    }


    const { data, error } =
        await supabase.rpc(
            'mining_upgrade',
            {
                p_user_id: message.author.id,
                p_type: typeMap[type]
            }
        );


    if (error) {

        console.error(
            '❌ upgrade RPC error:',
            error
        );

        return message.reply(
            '❌ 강화 처리 중 오류가 발생했습니다.'
        );
    }


    if (!data || !data.success) {

        if (
            data?.reason ===
            'NO_TOKEN'
        ) {

            return message.reply(
                `💰 토큰이 부족합니다.\n` +
                `필요: \`${data.cost}\`\n` +
                `보유: \`${data.tokens}\``
            );
        }


        return message.reply(
            '❌ 강화할 수 없습니다.'
        );
    }


    let name = '강화';

    if (data.type === 'pickaxe') {
        name = '⛏️ 곡괭이';
    }

    if (data.type === 'luck') {
        name = '🍀 행운';
    }

    if (data.type === 'yield') {
        name = '📦 채굴량';
    }


    return message.reply(
        `⬆️ **강화 성공!**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${name} → **Lv.${data.level}**\n` +
        `💸 비용: \`${data.cost}\` 토큰\n` +
        `💰 남은 토큰: \`${data.tokens}\``
    );
}


// =========================================================
// 🏆 !광산랭킹
// =========================================================

async function ranking(message) {

    const { data, error } =
        await supabase
            .from('mining_players')
            .select(
                'user_id, level, depth, xp'
            )
            .order('depth', {
                ascending: false
            })
            .order('xp', {
                ascending: false
            })
            .limit(10);


    if (error) {

        console.error(
            '❌ mining ranking error:',
            error
        );

        return message.reply(
            '❌ 광산 랭킹을 불러오지 못했습니다.'
        );
    }


    if (!data || data.length === 0) {

        return message.reply(
            '🏆 아직 광산 기록이 없습니다.'
        );
    }


    const lines = [];

    for (
        let i = 0;
        i < data.length;
        i++
    ) {

        const player =
            data[i];

        let discordUser;

        try {

            discordUser =
                await message.client.users.fetch(
                    player.user_id
                );

        } catch (e) {

            discordUser = null;
        }


        const name =
            discordUser
                ? discordUser.username
                : `Unknown (${player.user_id})`;


        const medal =
            i === 0
                ? '🥇'
                : i === 1
                    ? '🥈'
                    : i === 2
                        ? '🥉'
                        : `${i + 1}위`;


        lines.push(
            `${medal} **${name}** — ` +
            `📍 ${player.depth}m · ` +
            `⭐ Lv.${player.level} · ` +
            `✨ ${player.xp} XP`
        );
    }


    return message.reply(
        `🏆 **BLACK MINE 명예의 전당**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join('\n')
    );
}


// =========================================================
// 📖 !광산도움말
// =========================================================

async function help(message) {

    return message.reply(
        `⛏️ **BLACK MINE — 광산 시스템**\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        `⛏️ **기본 명령어**\n` +
        `\`!광산\` — 광산 상태 확인\n` +
        `\`!채굴\` — 광물 1회 채굴\n` +
        `\`!광물\` — 내 광물 확인\n` +
        `\`!광물목록\` — 전체 광물 도감\n\n` +

        `💰 **경제**\n` +
        `\`!광물판매 diamond 1\`\n` +
        `\`!광물판매 diamond all\`\n\n` +

        `⛏️ **장비**\n` +
        `\`!수리\` — 곡괭이 수리\n` +
        `\`!강화 곡괭이\`\n` +
        `\`!강화 행운\`\n` +
        `\`!강화 채굴량\`\n\n` +

        `🏆 **기타**\n` +
        `\`!광산랭킹\` — TOP 10\n\n` +

        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ 에너지는 최대 ${10}이며 **30분마다 1** 회복됩니다.\n` +
        `⭐ 레벨이 오르면 더 깊은 광산에 진입할 수 있습니다.`
    );
}


// =========================================================
// 🎯 메인 핸들러
// =========================================================

async function handleMiningCommand(message) {

    if (!message) {
        return false;
    }

    if (message.author?.bot) {
        return false;
    }


    const content =
        message.content.trim();

    if (!content) {
        return false;
    }


    const parts =
        content.split(/\s+/);

    const command =
        parts.shift();

    const args =
        parts;


    try {

        switch (command) {

            case '!광산':
                await showMine(message);
                return true;


            case '!채굴':
                await mine(message);
                return true;


            case '!광물':
                await showInventory(message);
                return true;


            case '!광물목록':
                await showOreList(message);
                return true;


            case '!광물판매':
                await sell(message, args);
                return true;


            case '!수리':
                await repair(message);
                return true;


            case '!강화':
                await upgrade(message, args);
                return true;


            case '!광산랭킹':
                await ranking(message);
                return true;


            case '!광산도움말':
                await help(message);
                return true;


            default:
                return false;
        }

    } catch (error) {

        console.error(
            '❌ Mining module error:',
            error
        );

        try {

            await message.reply(
                '❌ **광산 시스템 처리 중 오류가 발생했습니다.**'
            );

        } catch (replyError) {
            console.error(replyError);
        }

        return true;
    }
}


module.exports = {
  handleMiningCommand,
  showMine,
  mine,
  showInventory,
  showOreList,
  sell,
  repair,
  upgrade,
  ranking,
  help
};
